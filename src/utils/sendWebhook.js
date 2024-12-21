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

  if (response.status !== 200) {
    throw new Error("Failed to send webhook");
  } else if (response.data.error) {
    throw new Error(response.data.error);
  } else if (
    typeof response.data == "string" &&
    response.data.startsWith("<!DOCTYPE html>")
  ) {
    throw new Error("Invalid response from webhook URL or METHOD");
  }

  return response.data;
  console.log("bodyParams", bodyParams);
};

module.exports = { sendWebhook };
