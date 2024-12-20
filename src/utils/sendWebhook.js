const axios = require("axios");
const sendWebhook = async (route, lead) => {
  const { url, method, attributes } = route;

  const bodyParams = attributes.reduce((acc, attribute) => {
    acc[attribute.value] = lead[attribute.param];
    return acc;
  }, {});


  const response = await axios({
    method: method,
    url: url,
    data: bodyParams,
  });

  return response.data;
  console.log("bodyParams", bodyParams);
};

module.exports = { sendWebhook };
