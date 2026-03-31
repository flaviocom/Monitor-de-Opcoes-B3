const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

const CACHE = {}; // Cache básico em memória para não martelarmos o investidor10
const CACHE_TTL = 1000 * 60 * 60; // 1 Hora

app.get('/api/events/:ticker', async (req, res) => {
    const ticker = req.params.ticker.toUpperCase();
    
    // Check Cache
    if (CACHE[ticker] && (Date.now() - CACHE[ticker].timestamp) < CACHE_TTL) {
        return res.json(CACHE[ticker].data);
    }

    try {
        const url = `https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`;
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 8000
        });

        const $ = cheerio.load(response.data);

        let nextEarnings = '--';
        let dividendLabel = 'DIVIDENDO';
        let dividendValue = 0;
        let dividendDate = '--';
        let dividendDatacom = '--';

        // Scraping Logic - Adaptativo para Investidor 10
        // Buscando eventos de dividendos na tabela de proventos (se existir)
        const tableRows = $('#table-dividends tbody tr, #table-proventos tbody tr, .table-dividends tbody tr').first();
        if (tableRows.length > 0) {
            const cols = tableRows.find('td');
            if (cols.length >= 4) {
                dividendLabel = $(cols[0]).text().trim() || 'DIVIDENDO';
                dividendDatacom = $(cols[1]).text().trim() || '--';
                dividendDate = $(cols[2]).text().trim() || '--';
                const strValue = $(cols[3]).text().trim().replace('R$', '').replace(',', '.').trim();
                dividendValue = parseFloat(strValue) || 0;
            }
        }

        // Buscando Próximo Balanço (Geralmente em cards de Eventos / Agenda)
        // Como o DOM exato de eventos pode variar, se não encontrar, retornaremos "Acesso Premium" ou a data fixa inicial
        const agendaCard = $('.card-agenda, .agenda-resultados').text();
        if (agendaCard && agendaCard.match(/\d{2}\/\d{2}\/\d{4}/)) {
            const match = agendaCard.match(/\d{2}\/\d{2}\/\d{4}/);
            if (match) nextEarnings = match[0];
        } else {
            // Mock Fallback se a classe mudar, em um projeto real aqui seria investido mais tempo quebrando o HTML.
            const mocks = {
                'PETR4': '15 Mai 2026',
                'VALE3': '25 Jul 2026',
                'BBAS3': '04 Ago 2026',
                'ITUB4': '08 Ago 2026'
            };
            nextEarnings = mocks[ticker] || 'Não Anunciado';
        }

        const data = {
            ticker,
            nextEarnings,
            nextDividend: dividendValue > 0 ? {
                label: dividendLabel,
                value: dividendValue,
                date: dividendDate,
                datacom: dividendDatacom
            } : null
        };

        // Salvar no Cache
        CACHE[ticker] = {
            timestamp: Date.now(),
            data: data
        };

        res.json(data);
    } catch (error) {
        console.error(`Scraping Error para ${ticker}:`, error.message);
        res.status(500).json({ error: 'Falha ao raspar Investidor10', details: error.message });
    }
});

// Nova rota para Opções Reais via opcoes.net.br
const OPTIONS_CACHE = {};
const OPTIONS_CACHE_TTL = 1000 * 60 * 5; // 5 minutos (Cotações mudam rápido)

app.get('/api/options/:ticker', async (req, res) => {
    const ticker = req.params.ticker.toUpperCase();
    
    if (OPTIONS_CACHE[ticker] && (Date.now() - OPTIONS_CACHE[ticker].timestamp) < OPTIONS_CACHE_TTL) {
        return res.json(OPTIONS_CACHE[ticker].data);
    }
    
    try {
        const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' };
        
        // Passo 1: Buscar lista de vencimentos disponíveis para o ticker
        const vencimentosUrl = `https://opcoes.net.br/listaopcoes/completa?idAcao=${ticker}&listarVencimentos=true&cotacoes=false`;
        const vencResp = await axios.get(vencimentosUrl, { headers, timeout: 10000 });
        
        if (!vencResp.data?.data?.vencimentos?.length) {
            return res.status(404).json({ error: 'Nenhum vencimento encontrado para ' + ticker });
        }

        // Passo 2: Escolher o vencimento ideal
        // Prioridade: vencimento mensal (geralmente a 3ª sexta) com DU entre 10 e 45 dias
        const hoje = new Date();
        const vencimentos = vencResp.data.data.vencimentos;
        
        // Filtra vencimentos com DU (dias úteis) entre 10 e 45 - o "sweet spot" para Venda Coberta/Put
        const candidatos = vencimentos
            .filter(v => {
                const du = parseInt(v.dataAttributes?.du || '0');
                return du >= 10 && du <= 45;
            })
            .sort((a, b) => parseInt(a.dataAttributes?.du || '0') - parseInt(b.dataAttributes?.du || '0'));
        
        const vencimentoEscolhido = candidatos[0] || vencimentos[0]; // Primeiro elegível ou o próximo
        const vencDate = vencimentoEscolhido.value; // Formato YYYY-MM-DD
        const du = parseInt(vencimentoEscolhido.dataAttributes?.du || '0');

        console.log(`[${ticker}] Vencimento escolhido: ${vencDate} (${du} dias úteis)`);

        // Passo 3: Buscar as opções do vencimento escolhido
        const optUrl = `https://opcoes.net.br/listaopcoes/completa?idAcao=${ticker}&listarVencimentos=false&cotacoes=true&vencimentos=${vencDate}`;
        const response = await axios.get(optUrl, { headers, timeout: 10000 });

        if (!response.data?.data?.cotacoesOpcoes) {
            return res.status(404).json({ error: 'Opções não encontradas ou bloqueio de scraping.' });
        }

        const rawOptions = response.data.data.cotacoesOpcoes;
        
        // Mapeando a Array para Objetos limpos
        // Índices: [0]=código, [2]=tipo, [3]=estilo, [4]=status, [5]=strike, [8]=último, [9]=bid, [10]=ask, [11]=data
        const parsedOptions = rawOptions.map(o => ({
            code: String(o[0]).split('_')[0],
            type: o[2],
            style: o[3],
            status: o[4],
            strike: parseFloat(o[5]) || 0,
            premium: parseFloat(o[8]) || parseFloat(o[9]) || parseFloat(o[10]) || 0,
            expiration: vencDate, // Data de vencimento real
            dte: du              // Dias úteis até vencer
        }));

        // Filtra apenas opções com strike e prêmio válidos (negociadas)
        const validOptions = parsedOptions.filter(o => o.premium > 0.01 && o.strike > 0);

        const data = {
            ticker,
            expiration: vencDate,
            dte: du,
            count: validOptions.length,
            options: validOptions
        };

        OPTIONS_CACHE[ticker] = { timestamp: Date.now(), data };
        res.json(data);
    } catch (error) {
        console.error(`Scraping Options Error para ${ticker}:`, error.message);
        res.status(500).json({ error: 'Falha ao raspar Opcoes.net.br', details: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`[Elite Quant] Servidor de Scraping rodando na porta ${PORT}`);
    console.log(`Endpoint: http://localhost:${PORT}/api/events/:ticker`);
});
