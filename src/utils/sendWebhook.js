const axios = require("axios");

const sendWebhook = async (route, lead) => {
  const { url, method, attributes } = route;

  // Build body parameters
  const bodyParams = attributes.reduce((acc, attribute) => {
    if (attribute.type === "body") {
      if (attribute.param === "fullName" || attribute.param === "name") {
        // Concatenate first and last names for "fullName"
        acc[attribute.value] = `${lead.firstName || ""} ${
          lead.lastName || ""
        }`.trim();
      } else if (attribute.isCustom) {
        // Handle custom body attributes
        acc[attribute.param] = attribute.value;
      } else {
        // Map lead data to body attribute
        acc[attribute.value] = lead[attribute.param];
      }
    }
    return acc;
  }, {});

  // Build header parameters
  const headerParams = attributes.reduce((acc, attribute) => {
    if (attribute.type === "header") {
      acc[attribute.param] = attribute.value; // Remove isCustom check
    }
    return acc;
  }, {});

  try {
    // Make the webhook request
    const response = await axios({
      method: method,
      url: url,
      data: { ...bodyParams },
      headers: headerParams,
    });

    if (response.status !== 200) {
      throw new Error("Failed to send webhook");
    } else if (response.data.error) {
      throw new Error(response.data.error);
    } else if (
      typeof response.data === "string" &&
      response.data.startsWith("<!DOCTYPE html>")
    ) {
      throw new Error("Invalid response from webhook URL or METHOD");
    }

    console.log("Webhook response:", response.data);
    return response.data;
  } catch (error) {
    console.error("Error sending webhook:", error.message);
    throw error;
  }
};

module.exports = { sendWebhook };
