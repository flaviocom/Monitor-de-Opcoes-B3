const fs = require('fs');
let c = fs.readFileSync('index.html', 'utf8');
c = c.replace(/\\\$\\\{/g, '${');
c = c.replace(/\\\}/g, '}');
fs.writeFileSync('index.html', c);
console.log('Fixed syntax escapes in index.html');
