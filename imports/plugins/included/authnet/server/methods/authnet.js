/* eslint camelcase: 0 */
/* eslint quote-props: 0 */
// meteor modules
import { Meteor } from "meteor/meteor";
import { check, Match } from "meteor/check";
import { Promise } from "meteor/promise";

import AuthNetAPI from "authorize-net";
import { Reaction, Logger } from "/server/api";
import { Packages } from "/lib/collections";

function getAccountOptions() {
  let settings = Packages.findOne({
    name: "reaction-auth-net",
    shopId: Reaction.getShopId(),
    enabled: true
  }).settings;
  let ref = Meteor.settings.authnet;
  let options;

  options = {
    login: getSettings(settings, ref, "api_id"),
    tran_key: getSettings(settings, ref, "transaction_key")
  };

  if (!options.login) {
    throw new Meteor.Error("invalid-credentials", "Invalid Authnet Credentials");
  }
  return options;
}

function getSettings(settings, ref, valueName) {
  if (settings !== null) {
    return settings[valueName];
  } else if (ref !== null) {
    return ref[valueName];
  }
  return undefined;
}

Meteor.methods({
  authnetSubmit: function (transactionType = "authorizeTransaction", cardInfo, paymentInfo) {
    check(transactionType, String);
    check(cardInfo, {
      cardNumber: ValidCardNumber,
      expirationYear: ValidExpireYear,
      expirationMonth: ValidExpireMonth,
      cvv2: ValidCVV
    });
    check(paymentInfo, {
      total: String,
      currency: String
    });

    const order = {
      amount: paymentInfo.total
    };
    const creditCard = {
      creditCardNumber: cardInfo.cardNumber,
      cvv2: cardInfo.cvv2,
      expirationYear: cardInfo.expirationYear,
      expirationMonth: cardInfo.expirationMonth
    };
    const authnetService = getAuthnetService(getAccountOptions());
    const authnetTransactionFunc = authnetService[transactionType];
    let authResult;
    if (authnetTransactionFunc) {
      try {
        authResult = authnetTransactionFunc.call(authnetService,
          order,
          creditCard
        );
      } catch (error) {
        Logger.fatal(error);
      }
    } else {
      throw new Meteor.Error("403", "Invalid Transaction Type");
    }

    const result =  Promise.await(authResult);
    return result;
  },

  "authnet/payment/capture": function (paymentMethod) {
    check(paymentMethod, Reaction.Schemas.PaymentMethod);
    let {
      transactionId,
      amount
      } = paymentMethod;

    const authnetService = getAuthnetService(getAccountOptions());
    const roundedAmount = parseFloat(amount.toFixed(2));
    let result;
    try {
      const captureResult = priorAuthCaptureTransaction(transactionId,
        roundedAmount,
        authnetService
      );
      if (captureResult.responseCode[0] === "1") {
        result = {
          saved: true,
          response: captureResult
        };
      } else {
        result = {
          saved: false,
          error: captureResult
        };
      }
    } catch (error) {
      Logger.fatal(error);
      result = {
        saved: false,
        error: error
      };
    }
    return result;
  },

  "authnet/refund/create": function () {
    Meteor.Error("Not Implemented", "Reaction does not currently support processing refunds through " +
      "Authorize.net for security reasons. Please see the README for more details");
  },
  "authnet/refund/list": function () {
    Meteor.Error("Not Implemented", "Authorize.NET does not currently support getting a list of Refunds");
  }
});

function getAuthnetService(accountOptions) {
  const {
    login,
    tran_key,
    mode
    } = accountOptions;

  return new AuthNetAPI({
    API_LOGIN_ID: login,
    TRANSACTION_KEY: tran_key,
    testMode: !mode
  });
}

function priorAuthCaptureTransaction(transId, amount, service) {
  let body = {
    transactionType: "priorAuthCaptureTransaction",
    amount: amount,
    refTransId: transId
  };
  // This call returns a Promise to the cb so we need to use Promise.await
  let transactionRequest = service.sendTransactionRequest.call(service, body, function (trans) {
    return trans;
  });
  return Promise.await(transactionRequest);
}

ValidCardNumber = Match.Where(function (x) {
  return /^[0-9]{14,16}$/.test(x);
});

ValidExpireMonth = Match.Where(function (x) {
  return /^[0-9]{1,2}$/.test(x);
});

ValidExpireYear = Match.Where(function (x) {
  return /^[0-9]{4}$/.test(x);
});

ValidCVV = Match.Where(function (x) {
  return /^[0-9]{3,4}$/.test(x);
});

