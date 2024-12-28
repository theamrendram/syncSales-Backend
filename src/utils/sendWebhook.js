const axios = require("axios");
const sendWebhook = async (route, lead) => {
  const { url, method, attributes } = route;

  console.log("attributes", attributes);

  const bodyParams = attributes.reduce((acc, attribute) => {
    acc[attribute.value] = lead[attribute.param];
    if (attribute.param === "fullName")
      acc[attribute.value] = `${lead.firstName} ${lead.lastName}`;
    return acc;
  }, {});

  console.log("bodyParams", bodyParams);

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
};

module.exports = { sendWebhook };
