const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest'
};

// Rota 1: StatusInvest (DY e info)
app.get('/api/statusinvest/:ticker', async (req, res) => {
    try {
        const { ticker } = req.params;
        const url = `https://statusinvest.com.br/acoes/${ticker.toLowerCase()}`;
        
        const response = await axios.get(url, { headers });
        const $ = cheerio.load(response.data);
        
        const dy = $('.info[title="Dividend Yield"] strong').text() || '0,00';
        
        res.json({ ticker, dividendYield: dy });
    } catch (error) {
        console.error('StatusInvest Error:', error.message);
        res.status(500).json({ error: 'Erro ao buscar dados do StatusInvest' });
    }
});

// Rota 2: Opçoes.net.br (Grade e Código Exato)
app.get('/api/opcoesnet/:ticker', async (req, res) => {
    try {
        const { ticker } = req.params;
        const targetStrike = parseFloat(req.query.strike);
        const type = req.query.type; // 'CALL' ou 'PUT'
        
        const url = `https://opcoes.net.br/listaopcoes/completa?idAcao=${ticker.toUpperCase()}&listarVencimentos=true&cotacoes=true`;
        const response = await axios.get(url, { headers });
        
        let foundTicker = null;
        let closestStrike = null;
        
        if (response.data && response.data.success && response.data.data.cotacoesOpcoes) {
            const cotacoes = response.data.data.cotacoesOpcoes;
            let minDiff = Infinity;
            
            // O Opcoes.net.br retorna um array bidimensional, ex: [["PETRP450_2026", "PETR4", "PUT", ...]]
            for (let i = 0; i < cotacoes.length; i++) {
                const row = cotacoes[i];
                if (!row || row.length < 5) continue;
                
                // Formato tipico: [0] ID (ex: PETRP380_2026), [...], tipo (CALL/PUT) ... precisamos mapear pela lógica deles.
                // Na grade JSON deles: a string bruta no começo traz as informações principais
                const rawId = row[0].split('_')[0]; // "PETRD101" ou "[...]"
                const optionTickerMatch = rawId.match(/([A-Z]{4})([A-X])([A-Z0-9]+)/);
                
                // Vamos simplificar o parser
                const optionString = row.join('|');
                
                if (type && !optionString.includes(type)) continue;

                // Tenta rastrear o strike baseado no campo numerico mais semelhante ao modelo (geralmente depois do ticker)
                // Uma implementação mais complexa seria decodificar as posições exatas
                // Exemplo payload: "PETRP380", ... ,38.00,...
                const strikeInRow = parseFloat(row[row.length - 8] || row[4]); 
                // Fallback para buscar na string bruta se não soubermos a coluna
                const strikeMatch = optionString.match(/[0-9]{2}\.[0-9]{2}/);
                const actualStrike = strikeMatch ? parseFloat(strikeMatch[0]) : (typeof row[5] === 'number' ? row[5] : null);

                if (targetStrike && actualStrike) {
                    const diff = Math.abs(actualStrike - targetStrike);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestStrike = actualStrike;
                        foundTicker = rawId;
                    }
                }
            }
        }
        
        res.json({ ticker, requestedType: type, requestedStrike: targetStrike, bestMatch: foundTicker, matchStrike: closestStrike });
    } catch (error) {
        console.error('OpcoesNet Error:', error.message);
        res.status(500).json({ error: 'Erro ao buscar dados do Opoes.net.br' });
    }
});

app.listen(PORT, () => {
    console.log(`📡 Backend do Monitor operando na porta ${PORT}`);
    console.log(`Tente: http://localhost:${PORT}/api/statusinvest/petr4`);
});
