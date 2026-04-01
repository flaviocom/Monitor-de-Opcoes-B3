const axios = require('axios');
const cheerio = require('cheerio');

async function testOpcoesNet() {
    try {
        const url = 'https://opcoes.net.br/listaopcoes/completa?idAcao=PETR4&listarVencimentos=true&cotacoes=true';
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        console.log("OpcoesNet Success. Snippet:", JSON.stringify(data).substring(0, 500));
        
        // As seen before, format is somewhat like {"success":true,"data":{"cotacoesOpcoes":[[....]]}}
        if (data && data.data) {
             const v = data.data.vencimentos;
             console.log("Vencimentos:", v ? v.length : 'Not found');
             const c = data.data.cotacoesOpcoes;
             if(c && c.length > 0) {
                 console.log("Cotacoes array 0:", c[0].length ? c[0].length + ' items' : 'Not array');
                 if(c[0].length) console.log("First item:", c[0][0]);
             }
        }
    } catch (e) {
        console.error("Opcoes.net error:", e.message);
    }
}

async function testStatusInvest() {
    try {
        const url = 'https://statusinvest.com.br/acoes/petr4';
        const { data } = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        const $ = cheerio.load(data);
        const dy = $('.info[title="Dividend Yield"] .value').text();
        console.log("StatusInvest DY:", dy);
    } catch (e) {
        console.error("StatusInvest error:", e.response ? e.response.statusText : e.message);
    }
}

testOpcoesNet();
testStatusInvest();
