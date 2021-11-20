require("dotenv").config(); // load configs from .env

const log = require("signale");

const { Elarian } = require("elarian");

let client;

const mpesaChannel = {
  number: process.env.MPESA_PAYBILL,
  channel: "cellular",
};

let smsChannel = {
  channel: "sms",
  number: process.env.SMS_SHORT_CODE,
};

const purseId = process.env.PURSE_ID;

const clientPayment = async (customer, amount) => {
  log.info(`Processing loan for ${customer.customerNumber.number}`);

  const { name, day } = await customer.getMetadata();

  const res = await client.initiatePayment(
    {
      purseId,
    },
    {
      channelNumber: mpesaChannel,
      customerNumber: customer.customerNumber,
    },
    {
      amount,
      currencyCode: "KES",
    }
  );
  if (
    ![
      "success",
      "queued",
      "pending_confirmation",
      "pending_validation",
    ].includes(res.status)
  ) {
    log.error(
      `Failed to send KES ${amount} to ${customer.customerNumber.number} --> ${res.status}: `,
      res.description
    );
    return;
  }
  await customer.updateMetadata({
    name,
    fee: amount,
  });
  await customer.sendMessage(smsChannel, {
    body: {
      text: `Congratulations ${name}!\nYour fee of KES ${amount} has been received succesfully!`,
    },
  });
};

async function sendResults(num, day) {
  let telegramChannel = {
    channel: "telegram",
    number: "kibandi",
  };
  const patient = new client.Customer({
    number: num,
    provider: "cellular",
  });
  await patient
    .sendMessage(smsChannel, {
      body: {
        text: `Your appointment has been scheduled. Thank You for your time. See You on ${day}! :-)`,
      },
    })
    .catch((error) => {
      console.log(error.message);
      console.log("message not sent......");
    });
}

const processUssd = async (notification, customer, appData, callback) => {
  let patientNumber = notification.customerNumber.number;
  console.log(notification.customerNumber.number);
  try {
    log.info(`Processing USSD from ${customer.customerNumber.number}`);
    const input = notification.input.text;

    let screen = "home";
    if (appData) {
      screen = appData.screen;
    }

    const customerData = await customer.getMetadata();
    let { name, day } = customerData;
    const menu = {
      text: null,
      isTerminal: false,
    };
    let nextScreen = screen;
    if (screen === "home" && input !== "") {
      if (input === "1") {
        nextScreen = "request-alienId";
      } else if (input === "2") {
        nextScreen = "request-nationalId";
      } else if (input === "3") {
        nextScreen = "quit";
      }
    }
    if (screen === "home" && input === "") {
      if (name) {
        nextScreen = "schedule-day";
      }
    }
    switch (nextScreen) {
      case "request-alienId":
        menu.text = "Alright, what is your Alien ID?";
        nextScreen = "request-name";
        callback(menu, {
          screen: nextScreen,
        });
        break;
      case "request-nationalId":
        menu.text = "Alright, what is your National ID?";
        nextScreen = "request-name";
        callback(menu, {
          screen: nextScreen,
        });
        break;
      case "request-name":
        menu.text = "Enter your Full Name";
        nextScreen = "request-nhif";
        callback(menu, {
          screen: nextScreen,
        });
        break;
      case "request-nhif":
        menu.text = "Which medical insurance cover do you have?\n1. NHIF \n2. AON Minet\n3. Other";
        nextScreen = "request-nhif";
        callback(menu, {
          screen: nextScreen,
        });
        break;
      case "request-nhifNo":
        menu.text = "Enter your NHIF Number";
        nextScreen = "request-nhif";
        callback(menu, {
          screen: nextScreen,
        });
        break;
      case "schedule-day":
        name = input;
        menu.text = `What day would you like to schedule ${name}\n1. Monday\n2. Tuesday\n3. Wednesday\n4. Thursday\n5. Friday`;
        nextscreen = "confirm-day";
        callback(menu, {
          screen: nextscreen,
        });
        break;
      case "confirm-day":
        let value = input;

        week = {
          1: "Monday",
          2: "Tuesday",
          3: "Wednesday",
          4: "Thursday",
          5: "Friday",
        };
        day = week[value];
        menu.text = `Thank you,\n we will get back to you on the availability of ${day}. You will be charged 1000 bob for consultation!`;
        menu.isTerminal = true;
        nextscreen = "home";
        callback(menu, { screen: nextscreen });
        await sendResults(patientNumber, day);
        await clientPayment(customer, 1000);
        break;
      case "quit":
        menu.text = "Happy Coding!";
        menu.isTerminal = true;
        nextScreen = "home";
        callback(menu, {
          screen: nextScreen,
        });
        break;

      default:
        menu.text =
          "Welcome to E-Health! Are you a?\n1. Foreigner \n2. Citizen\n3. Quit";
        menu.isTerminal = false;
        callback(menu, {
          screen: nextScreen,
        });
        break;
    }
    await customer.updateMetadata({
      name,
      day,
    });
  } catch (error) {
    log.error("USSD Error: ", error);
  }
};

const start = () => {
  client = new Elarian({
    appId: process.env.APP_ID,
    orgId: process.env.ORG_ID,
    apiKey: process.env.API_KEY,
  });
  client.on("ussdSession", processUssd);

  client
    .on("error", (error) => {
      log.warn(error.message || error);
    })
    .on("connected", () => {
      log.success(
        `App is connected, waiting for customers on ${process.env.USSD_CODE}`
      );
    })
    .connect();
};
start();
