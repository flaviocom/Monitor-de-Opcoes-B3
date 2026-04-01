const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
};

// ================================================================
// Rota 1: Dados Fundamentalistas (VPA, LPA, Preço Justo, DataCom)
// GET /api/fundamentals/:ticker
// ================================================================
app.get('/api/fundamentals/:ticker', async (req, res) => {
    try {
        const { ticker } = req.params;
        const url = `https://statusinvest.com.br/acoes/${ticker.toLowerCase()}`;
        
        const response = await axios.get(url, { headers, timeout: 10000 });
        const $ = cheerio.load(response.data);
        
        // Helper para extrair texto de indicadores pelo título
        function getIndicator(titleText) {
            let val = null;
            $('div.info, div[title]').each((i, el) => {
                const title = $(el).attr('title') || $(el).find('h3, span').first().text();
                if (title && title.toLowerCase().includes(titleText.toLowerCase())) {
                    val = $(el).find('strong.value, div.value, span.value, strong').first().text().trim();
                }
            });
            return val;
        }
        
        // Tenta extrair indicadores com múltiplos seletores robustos
        const rawVPA = $('[title="VPA"] strong').text().trim() ||
                       $('[title="Valor Patrimonial"] strong').text().trim() ||
                       $('.info:contains("VPA") strong').first().text().trim() || null;

        const rawLPA = $('[title="LPA"] strong').text().trim() ||
                       $('[title="Lucro por Ação"] strong').text().trim() ||
                       $('.info:contains("LPA") strong').first().text().trim() || null;

        const rawDY  = $('[title="Dividend Yield"] strong').text().trim() ||
                       $('[title="DY"] strong').text().trim() || null;

        const rawPVP = $('[title="P/VP"] strong').text().trim() ||
                       $('[title="Preço/Valor Patrimonial"] strong').text().trim() || null;

        // Normaliza: converte string BR ("12,34") para float
        const parseBR = (str) => {
            if (!str) return null;
            const clean = str.replace(/[^0-9,.-]/g, '').replace(',', '.');
            const num = parseFloat(clean);
            return isNaN(num) ? null : num;
        };

        const vpa = parseBR(rawVPA);
        const lpa = parseBR(rawLPA);
        const dy  = parseBR(rawDY);
        const pvp = parseBR(rawPVP);

        // Preço Justo de Graham: √(22.5 × VPA × LPA)
        let grahamPrice = null;
        if (vpa !== null && lpa !== null && vpa > 0 && lpa > 0) {
            grahamPrice = parseFloat(Math.sqrt(22.5 * vpa * lpa).toFixed(2));
        }

        // ================================================
        // Busca Data Com / Próximos Dividendos
        // ================================================
        let nextDividend = null;
        try {
            // Tenta pegar da tabela de proventos do StatusInvest
            const proventosTable = $('#earning-section, #dividends-section, table.dividends');
            let dataCom = null;
            let valor = null;
            let tipo = null;

            // Procura em linhas de tabela a linha mais recente com data futura
            const today = new Date();
            $('table tr').each((i, row) => {
                const cells = $(row).find('td');
                if (cells.length >= 3) {
                    const cellText = cells.map((j, c) => $(c).text().trim()).get();
                    // Procura por padrão de data DD/MM/YYYY em alguma célula
                    const dateMatch = cellText.find(t => /^\d{2}\/\d{2}\/\d{4}$/.test(t));
                    if (dateMatch) {
                        const [d, m, y] = dateMatch.split('/').map(Number);
                        const cellDate = new Date(y, m - 1, d);
                        if (cellDate >= today) {
                            // Data futura encontrada — provavelmente a Data Com
                            dataCom = dateMatch;
                            valor = parseBR(cellText.find(t => /^[\d,]+$/.test(t) && parseBR(t) > 0));
                            tipo = cellText.find(t => /dividendo|jcp|rendimento/i.test(t)) || 'DIVIDENDO';
                        }
                    }
                }
            });

            if (dataCom) {
                const [d, m, y] = dataCom.split('/').map(Number);
                const dataComDate = new Date(y, m - 1, d);
                const diffMs = dataComDate - today;
                const diasParaDataCom = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                nextDividend = {
                    label: typeof tipo === 'string' ? tipo.toUpperCase() : 'DIVIDENDO',
                    value: valor || 0,
                    datacom: dataCom,
                    diasParaDataCom,
                };
            }
        } catch (e) {
            console.warn('DataCom parse error:', e.message);
        }

        res.json({
            ticker: ticker.toUpperCase(),
            vpa,
            lpa,
            dy,
            pvp,
            grahamPrice,
            nextDividend,
            source: 'statusinvest',
            fetchedAt: new Date().toISOString(),
        });

    } catch (error) {
        console.error(`Fundamentals Error [${req.params.ticker}]:`, error.message);
        res.status(500).json({ error: 'Erro ao buscar dados fundamentalistas', details: error.message });
    }
});

// ================================================================
// Rota 2: Eventos Corporativos (Balanços, Dividendos) - Investidor10
// GET /api/events/:ticker
// ================================================================
app.get('/api/events/:ticker', async (req, res) => {
    try {
        const { ticker } = req.params;
        const url = `https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`;

        const response = await axios.get(url, {
            headers: { ...headers, 'Referer': 'https://investidor10.com.br/' },
            timeout: 10000
        });
        const $ = cheerio.load(response.data);

        let nextEarnings = '--';
        let nextDividend = null;

        // Busca data do próximo balanço
        $('h3, h4, span, td, li').each((i, el) => {
            const text = $(el).text().trim();
            if (/balanço|resultado|earnings/i.test(text) && /\d{2}\/\d{2}\/\d{4}/.test(text)) {
                const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                if (match) {
                    nextEarnings = `${match[1]}/${match[2]}/${match[3]}`;
                }
            }
        });

        // Busca na tabela de dividendos mais recente
        const today = new Date();
        $('table tr').each((i, row) => {
            if (nextDividend) return; // já achou
            const cells = $(row).find('td');
            if (cells.length >= 2) {
                const cellText = cells.map((j, c) => $(c).text().trim()).get();
                const dateMatch = cellText.find(t => /^\d{2}\/\d{2}\/\d{4}$/.test(t));
                if (dateMatch) {
                    const [d, m, y] = dateMatch.split('/').map(Number);
                    const cellDate = new Date(y, m - 1, d);
                    if (cellDate > today) {
                        const parseBR = (str) => {
                            if (!str) return null;
                            const clean = str.replace(/[^0-9,.-]/g, '').replace(',', '.');
                            const num = parseFloat(clean);
                            return isNaN(num) ? null : num;
                        };
                        const valor = parseBR(cellText.find(t => /^[\d,.]+$/.test(t) && parseBR(t) > 0));
                        const tipo = cellText.find(t => /dividendo|jcp|rendimento/i.test(t)) || 'DIVIDENDO';
                        const diffMs = cellDate - today;
                        const diasParaDataCom = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                        nextDividend = {
                            label: tipo.toString().toUpperCase(),
                            value: valor || 0,
                            datacom: dateMatch,
                            diasParaDataCom,
                        };
                    }
                }
            }
        });

        res.json({ ticker: ticker.toUpperCase(), nextEarnings, nextDividend, source: 'investidor10' });

    } catch (error) {
        console.error(`Events Error [${req.params.ticker}]:`, error.message);
        res.status(500).json({ error: 'Erro ao buscar eventos', details: error.message });
    }
});

// ================================================================
// Rota 3: Grade de Opções (opcoes.net.br)
// GET /api/options/:ticker
// ================================================================
app.get('/api/options/:ticker', async (req, res) => {
    try {
        const { ticker } = req.params;
        const url = `https://opcoes.net.br/listaopcoes/completa?idAcao=${ticker.toUpperCase()}&listarVencimentos=true&cotacoes=true`;
        const response = await axios.get(url, { headers, timeout: 10000 });

        if (!response.data?.success || !response.data?.data?.cotacoesOpcoes) {
            return res.json({ ticker, options: [], dte: null });
        }

        const cotacoes = response.data.data.cotacoesOpcoes;
        const vencimentos = response.data.data.vencimentos || [];
        
        // Pega o próximo vencimento (opções mensais B3 — 3ª sexta-feira)
        const now = new Date();
        let nextVenc = vencimentos.find(v => new Date(v) > now) || vencimentos[0];
        const dteMs = nextVenc ? new Date(nextVenc) - now : null;
        const dte = dteMs ? Math.ceil(dteMs / (1000 * 60 * 60 * 24)) : null;

        const options = [];
        for (const row of cotacoes) {
            if (!row || !Array.isArray(row) || row.length < 10) continue;
            
            // Formato Opcoes.net.br: [ID_VENC, ..., tipo, ..., strike, last, ...]
            const rawId = String(row[0]).split('_')[0]; // ex: "PETRP380"
            const optionString = row.join('|');
            
            // Detecta tipo
            const isPUT  = /\bPUT\b/i.test(optionString);
            const isCALL = /\bCALL\b/i.test(optionString);
            const type = isPUT ? 'PUT' : isCALL ? 'CALL' : null;
            if (!type) continue;

            // Detecta strike: procura número no formato XX.XX
            const strikeMatch = optionString.match(/\b(\d{2,4}[.,]\d{2})\b/);
            let strike = null;
            if (strikeMatch) {
                strike = parseFloat(strikeMatch[1].replace(',', '.'));
            }
            // Fallback: decodifica letra do ticker (padrão BVMF)
            if (!strike && rawId.length >= 6) {
                const strikePart = rawId.slice(5);
                strike = parseFloat(strikePart) || null;
            }
            if (!strike) continue;

            // Premium (last price)
            let premium = null;
            for (const cell of row) {
                const num = parseFloat(String(cell).replace(',', '.'));
                if (!isNaN(num) && num > 0 && num < 50 && num !== strike) {
                    premium = num;
                    break;
                }
            }

            options.push({ code: rawId, type, strike, premium: premium || 0, expiration: nextVenc });
        }

        res.json({ ticker, options, dte, nextExpiration: nextVenc });

    } catch (error) {
        console.error(`Options Error [${req.params.ticker}]:`, error.message);
        res.status(500).json({ error: 'Erro ao buscar opções', details: error.message });
    }
});

// ================================================================
// Rota Legacy compatível
// ================================================================
app.get('/api/statusinvest/:ticker', (req, res) => {
    res.redirect(`/api/fundamentals/${req.params.ticker}`);
});

app.listen(PORT, () => {
    console.log(`\n📡 ThetaLens Backend operando na porta ${PORT}`);
    console.log(`✅ Fundamentais:  http://localhost:${PORT}/api/fundamentals/petr4`);
    console.log(`✅ Eventos:       http://localhost:${PORT}/api/events/petr4`);
    console.log(`✅ Opções:        http://localhost:${PORT}/api/options/petr4`);
});
