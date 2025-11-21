const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const FCM_SERVER_KEY = "YOUR_FCM_SERVER_KEY_HERE";  // IMPORTANT

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
        notification: {
          title,
          body,
        },
        data,
      }),
    });

    console.log("FCM Response:", await response.text());
  } catch (err) {
    console.error("FCM Error:", err.message);
  }
}

module.exports = sendNotification;
