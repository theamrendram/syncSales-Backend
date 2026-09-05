const axios = require("axios");
const { logLeadWebhook } = require("./lead-log");

const sendWebhook = async (route, lead, log) => {
  const startedAt = Date.now();

  // Attribute mapping runs inside the try so a malformed route is reported like
  // any other webhook failure instead of throwing past the log call.
  try {
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

    logLeadWebhook(log, {
      lead,
      route,
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
      data: response.data,
    });

    return response.data;
  } catch (error) {
    // Only the downstream identifier and verdict are logged. The body itself is
    // persisted on Lead.webhookResponse and routinely carries that system's
    // customer records.
    logLeadWebhook(log, {
      lead,
      route,
      httpStatus: error.response?.status,
      durationMs: Date.now() - startedAt,
      data: error.response?.data,
      err: error,
    });
    throw error;
  }
};

module.exports = { sendWebhook };
