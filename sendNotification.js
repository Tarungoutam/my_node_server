// sendNotification.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const FCM_SERVER_KEY = "AIzaSyBEUCg6yrVRAnI-zwrKSjHmiuJ8YCM5yAQ"; // <-- your server key

async function sendNotification(token, title, body, data = {}) {
  try {
    const response = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        Authorization: `key=${FCM_SERVER_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: token,
        notification: { title, body },
        data,
      }),
    });

    console.log("🔔 FCM Response:", await response.text());
  } catch (err) {
    console.error("❌ FCM Error:", err.message);
  }
}

module.exports = sendNotification;
