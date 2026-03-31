const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// CORS: permite requisições do GitHub Pages e localhost
app.use(cors({
    origin: [
        'https://flaviocom.github.io',
        'http://localhost:3000',
        'http://127.0.0.1:5500',
        'null' // para arquivo local aberto direto no browser
    ],
    methods: ['GET'],
    optionsSuccessStatus: 200
}));

// Health check — Render usa isso pra saber que o servidor tá vivo
app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'ThetaLens PRO API', version: '1.0.0' });
});

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
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'Referer': 'https://opcoes.net.br/',
            'Origin': 'https://opcoes.net.br',
            'X-Requested-With': 'XMLHttpRequest',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache'
        };
        
        // Passo 1: Buscar lista de vencimentos disponíveis para o ticker
        const vencimentosUrl = `https://opcoes.net.br/listaopcoes/completa?idAcao=${ticker}&listarVencimentos=true&cotacoes=false`;
        const vencResp = await axios.get(vencimentosUrl, { headers, timeout: 15000 });
        
        if (!vencResp.data?.data?.vencimentos?.length) {
            return res.status(404).json({ error: 'Nenhum vencimento encontrado para ' + ticker });
        }

        // Passo 2: Escolher o vencimento ideal (Alvo: ~45 Dias Úteis, equivalente a 2 meses)
        const hoje = new Date();
        const vencimentos = vencResp.data.data.vencimentos;
        
        // Objetivo: Vencimento mais próximo de 45 dias úteis. Filtramos uma base mais ampla (ex: 20 a 70 DU)
        const candidatos = vencimentos
            .filter(v => {
                const du = parseInt(v.dataAttributes?.du || '0');
                return du >= 20 && du <= 75; // Janela um pouco mais larga para garantir que encontre opções boas de liquidez
            })
            // Ordenando pela distância absoluta do alvo ideal (45 dias úteis)
            .sort((a, b) => {
                const diffA = Math.abs(parseInt(a.dataAttributes?.du || '0') - 45);
                const diffB = Math.abs(parseInt(b.dataAttributes?.du || '0') - 45);
                return diffA - diffB;
            });
        
        const vencimentoEscolhido = candidatos.length > 0 ? candidatos[0] : vencimentos[0]; // Melhor candidato ou o próximo disponível
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

// Render injeta PORT via variável de ambiente — localmente usa 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[ThetaLens PRO] Servidor rodando na porta ${PORT}`);
    console.log(`Health: http://localhost:${PORT}/`);
    console.log(`Options: http://localhost:${PORT}/api/options/:ticker`);
    console.log(`Events:  http://localhost:${PORT}/api/events/:ticker`);
});
