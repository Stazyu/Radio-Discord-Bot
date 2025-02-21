const fetch = require("node-fetch");
const { isUrl } = require("./helpers/validator");

// fetch('http://stream.denger.in')
//     .then((res) =>
//         res.url
//     )
//     .then((data) => {
//         console.log(data);
//     })
//     .catch((err) => {

//     });

console.log(isUrl(`https://n0e.radiojar.com/7csmg90fuqruv?1738159486=&rj-tok=AAABlLJq-CIAYC_cH4oErrf2IA&rj-ttl=5`));
