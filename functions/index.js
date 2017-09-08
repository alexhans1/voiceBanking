'use strict';

const { ApiAiApp } = require('actions-on-google');
const functions = require('firebase-functions');

const category_mapping = require('./category_mapping');
const ibans = require('./ibans');

let dotenv = require('dotenv'); //enables environment variables for development
dotenv.config({path: '../.env'});

process.env.DEBUG = 'actions-on-google:*';

/** API.AI Actions {@link https://api.ai/docs/actions-and-parameters#actions} */
const Actions = {
	UNRECOGNIZED_DEEP_LINK: 'deeplink.unknown',
	TELL_ACCOUNT_BALANCE: 'tell.account_balance',
	TELL_SPENDING: 'tell.spending'
};

let _ = require('lodash');
let moment = require('moment');

let request = require('request-promise');

let DEF_MODE = true;
let LIVE = false;


let usedURL = 'https://sandbox.finapi.io';
let hostURL = 'sandbox.finapi.io';

const CLIENT_ID = (LIVE) ? functions.config().finapi.clientid : process.env.finApiClientID;
const CLIENT_SECRET = (LIVE) ? functions.config().finapi.clientsecret : process.env.finApiClientSecret;
const USERNAME = (LIVE) ? functions.config().finapi.testuserid : process.env.finApiUsername;
const USERPW = (LIVE) ? functions.config().finapi.testuserpassword : process.env.finApiUserPassword;
const BANKID = (LIVE) ? functions.config().finapi.testuserbankid : process.env.bankingID;
const BANKPIN = (LIVE) ? functions.config().finapi.testuserbankpw : process.env.bankingPIN;

let ACCESS_TOKEN;
let USER_TOKEN;
let USER_REFRESH_TOKEN;
let CONNECTION_ID;
let TRANSACTIONS;
let SPENDING_AMOUNT;
let ACCOUNTS;

// INPUTS FROM API.AI
let SEARCH_START_DATE = null;
let SEARCH_END_DATE = null;
let SEARCH_CATEGORY = null;


// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// ++++++++++++++++++++++++++++++++++ PROCESS THE ACTIONS REQUEST +++++++++++++++++++++++++++++++++++++++++++++++++++++
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


/**
 * Greet the user and direct them to next turn
 * @param {ApiAiApp} app ApiAiApp instance
 * @return {void}
 */
const unhandledDeepLinks = app => {
	return app.ask('What the fuck?')
};

const tellAccountBalance = app => {

	getAllAccounts(USER_TOKEN);

	setTimeout(() => {
		let balance = ACCOUNTS[0].balance;
		return app.tell('Hi, you have ' + balance + ' Euro on your bank account.');
	}, 1000);
};

const tellSpending = app => {

	// get parameters
	SEARCH_CATEGORY = category_mapping.map(app.getArgument('spending_categories'));
	let date = app.getArgument('date-period');
	SEARCH_START_DATE = date.substring(0, date.indexOf('/'));
	SEARCH_END_DATE = date.substring(date.indexOf('/') + 1, date.length);
	console.log('parsed parameters: ', SEARCH_CATEGORY, SEARCH_START_DATE, SEARCH_END_DATE);

	searchBankTransactions(USER_TOKEN);

	setTimeout(() => {
		return app.tell('You spent ' + SPENDING_AMOUNT + ' Euro in the given time period.');
	}, 1000);
};

const respondToSepaRequest = app => {

	// get parameters
	const recipientName = app.getArgument('sepa.recipientName'),
		amount = app.getArgument('sepa.amount'),
		purpose = app.getArgument('sepa.purpose');

	let response = requestSEPAMoneyTransfer(
		USER_TOKEN,
		recipientName,
		ibans[recipientName],
		amount,
		purpose,
		ACCOUNTS[0].id,
		'921'
	);

	setTimeout(() => {
		return app.tell('You spent ' + SPENDING_AMOUNT + ' Euro in the given time period.');
	}, 1000);
};


// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// ++++++++++++++++++++++++++++++++++ CONNECTING TO BANK TO GET TRANSACTIONS ++++++++++++++++++++++++++++++++++++++++++
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

const authenticateClient = () => {
	
	let authenticateClientOptions = {
		method: 'POST',
		uri: usedURL + '/oauth/token?grant_type=client_credentials&' +
		'client_id=' + CLIENT_ID +
		'&client_secret=' + CLIENT_SECRET,
		headers: [{
			name: 'content-type',
			value: 'application/json'
		}],
		json: true
	};
	
	console.log(authenticateClientOptions.uri);
	
	request(authenticateClientOptions)
	.then(function (parsedBody) {
		ACCESS_TOKEN = parsedBody.access_token;

		if (DEF_MODE) console.log('ACCESS_TOKEN', ACCESS_TOKEN);

		// createUser(ACCESS_TOKEN,
		// 	process.env.finApiUsername,
		// 	process.env.finApiUserPassword,
		// 	process.env.finApiUserEmail,
		// 	process.env.finApiUserPhone
		// );
		authenticateUser(ACCESS_TOKEN, USERNAME, USERPW);
	})
	.catch(function (ex) {
		console.error("$$$ Error while getting client token.");
		console.error(ex);
	});

};

const createUser = (clientToken, userID, userPassword, userEmail, userPhone) => {

	let createUserOptions = {
		method: 'POST',
		url: usedURL + '/api/v1/users',
		body: {
			"id": userID,
			"password": userPassword,
			"email": userEmail,
			"phone": userPhone,
			"isAutoUpdateEnabled": true
		},
		headers: {
			'content-type': 'application/json',
			'Authorization': 'Bearer ' + clientToken
		},
		json: true
	};

	try {
		request(createUserOptions)
		.then(function (parsedBody) {
			console.log(parsedBody);
		})
		.catch(function (err) {
			console.error("$$$ Error while creating new user.");
			console.log(err.message);
		});
	} catch (ex) {
		console.error("$$$ Error while creating new user.");
		console.log(ex);
	}

};

const authenticateUser = (clientToken, userID, userPassword) => {

	let authenticateUserOptions = {
		method: 'POST',
		url: usedURL + '/oauth/token?grant_type=password&' +
		'client_id=' + CLIENT_ID + '&' +
		'client_secret=' + CLIENT_SECRET + '&' +
		'username='	+ userID + '&password=' + userPassword,
		headers: {
			'content-type': 'application/json',
			'Authorization': 'Bearer ' + clientToken
		},
		json: true
	};

	request(authenticateUserOptions)
	.then(function (parsedBody) {
		USER_TOKEN = parsedBody.access_token;
		USER_REFRESH_TOKEN = parsedBody.refresh_token;

		if (DEF_MODE) console.log('USER_TOKEN', USER_TOKEN);

		getAllBankConnections(USER_TOKEN);
	})
	.catch(function (err) {
		console.error("$$$ Error while authenticating user.");
		console.log(err.message);
	});
};

const importBankConnection = (userToken, bankingUserId, bankingPIN, bankID) => {

	console.log('$$$ Importing new Bank Connection.');

	let importBankConnectionOptions = {
		method: 'POST',
		url: usedURL + '/api/v1/bankConnections/import',
		body: {
			"bankId": bankID,
			"bankingUserId": bankingUserId,
			"bankingPin": bankingPIN,
			"storePin": true,
			"name": "BDU DKB Bank Account",
			"skipPositionsDownload": false,
			"maxDaysForDownload": 0
		},
		headers: {
			'content-type': 'application/json',
			'Authorization': 'Bearer ' + userToken
		},
		json: true
	};

	try {
		request(importBankConnectionOptions)
		.then(function (parsedBody) {
			CONNECTION_ID = parsedBody.id;

			if (DEF_MODE) console.log('CONNECTION_ID', CONNECTION_ID);

			getConnectionStatus(USER_TOKEN, CONNECTION_ID)
		})
		.catch(function (err) {
			console.error("$$$ Error while importing bank connections.");
			console.log(err.message);
		});
	} catch (ex) {
		console.log(ex);
	}
};

const updateBankConnection = (userToken, bankConnectionId) => {

	console.log('$$$ Updating Bank Connection.');

	let updateBankConnectionOptions = {
		method: 'POST',
		url: usedURL + '/api/v1/bankConnections/update',
		body: {
			"bankConnectionId": bankConnectionId,
			"importNewAccounts": false,
			"skipPositionsDownload": false,
		},
		headers: {
			'content-type': 'application/json',
			'Authorization': 'Bearer ' + userToken
		},
		json: true
	};

	try {
		request(updateBankConnectionOptions)
		.then(function (parsedBody) {
			CONNECTION_ID = parsedBody.id;

			if (DEF_MODE) console.log('CONNECTION_ID', CONNECTION_ID);

			getConnectionStatus(USER_TOKEN, CONNECTION_ID)
		})
		.catch(function (err) {
			console.error("$$$ Error while updating bank connections.");
			console.log(err.message);
		});
	} catch (ex) {
		console.log(ex);
	}
};

const getAllBankConnections = (userToken) => {

	let getAllBankConnectionsOptions = {
		method: 'GET',
		url: usedURL + '/api/v1/bankConnections/',
		headers: {
			'Authorization': 'Bearer ' + userToken
		},
		json: true
	};

	try {
		request(getAllBankConnectionsOptions)
		.then(function (parsedBody) {
			if (parsedBody.connections.length) {
				CONNECTION_ID = parsedBody.connections[0].id;
				if (DEF_MODE) console.log('CONNECTION_ID', CONNECTION_ID);
			} else {
				console.log('$$$ There is no bank connection. Please import one!');
				importBankConnection(USER_TOKEN, BANKID, BANKPIN, '24353');
			}
		})
		.catch(function (err) {
			console.error("$$$ Error while getting bank connections.");
			console.log(err.message);
		});
	} catch (ex) {
		console.log(ex);
	}

};

const getConnectionStatus = (userToken, connectionID) => {

	let connStatus = null;

	let getConnectionStatusOptions = {
		method: 'GET',
		url: usedURL + '/api/v1/bankConnections/' + connectionID,
		headers: {
			'Authorization': 'Bearer ' + userToken
		},
		json: true
	};

	try {
		request(getConnectionStatusOptions)
		.then(function (parsedBody) {
			connStatus = parsedBody.updateStatus;
			if (DEF_MODE) console.log('updateStatus', parsedBody.updateStatus);

			if (connStatus === 'READY') {
				getAllAccounts(USER_TOKEN);
			}
			else {
				try {
					setTimeout(function(){
						getConnectionStatus(USER_TOKEN, CONNECTION_ID);
					}, 500);
				} catch (ex) {
					console.log(ex);
				}
			}
		})
		.catch(function (err) {
			console.error("$$$ Error while getting connection status.");
			console.log(err.message);
		});
	} catch (ex) {
		console.log(ex);
	}
};

const getAllTransactions = (userToken, page) => {

	let getAllTransactionsOptions = {
		method: 'GET',
		url: usedURL + '/api/v1/transactions?view=userView&' +
		'direction=all&' +
		'includeChildCategories=true&' +
		'page=' + page + '&' +
		'perPage=100&' +
		'minBankBookingDate=' + moment().subtract(1, 'days').format('YYYY-MM-DD') + '&' +
		'order=bankBookingDate%2Cdesc',
		headers: {
			'Authorization': 'Bearer ' + userToken
		},
		json: true
	};

	try {
		request(getAllTransactionsOptions)
		.then(function (parsedBody) {
			TRANSACTIONS = parsedBody;

			if (DEF_MODE) console.log('TRANSACTIONS', TRANSACTIONS.transactions);
		})
		.catch(function (err) {
			console.error("$$$ Error while getting all transactions.");
			console.log(err.message);
		});
	} catch (ex) {
		console.log(ex);
	}

};

const searchBankTransactions = (userToken) => {

	let propertiesObject = {
		view: 'bankView',
		direction: 'spending',
		includeChildCategories: 'true',
		page: '1',
		perPage: '500',
		minBankBookingDate: moment(SEARCH_START_DATE).format('YYYY-MM-DD'),
		maxBankBookingDate: moment(SEARCH_END_DATE).format('YYYY-MM-DD'),
		categoryIds: SEARCH_CATEGORY
	};

	if (!LIVE) {
	    propertiesObject.minBankBookingDate = moment().subtract(4, 'month').format('YYYY-MM-DD');
	    propertiesObject.maxBankBookingDate = moment().format('YYYY-MM-DD');
	    propertiesObject.categoryIds = '401';
	    
	}

	let getAllTransactionsOptions = {
		method: 'GET',
		url: usedURL + '/api/v1/transactions',
		qs: propertiesObject,
		headers: {
			'Authorization': 'Bearer ' + userToken
		},
		json: true
	};

	try {
		request(getAllTransactionsOptions)
		.then(function (parsedBody) {
			if (parsedBody.transactions.length) {
				SPENDING_AMOUNT = -parsedBody.spending;
				if (DEF_MODE) console.log('SPENDING_AMOUNT', SPENDING_AMOUNT);
			} else {
				SPENDING_AMOUNT = 0;
				if (DEF_MODE) console.log('CATEGORY TRANSACTIONS', parsedBody);
			}

		})
		.catch(function (err) {
			console.error("$$$ Error while getting all transactions.");
			console.log(err.message);
		});
	} catch (ex) {
		console.log(ex);
	}

};

const getAllAccounts = (userToken) => {

	let getAllAccountsOptions = {
		method: 'GET',
		url: usedURL + '/api/v1/accounts/',
		headers: {
			'Authorization': 'Bearer ' + userToken
		},
		json: true
	};

	try {
		request(getAllAccountsOptions)
		.then(function (parsedBody) {
			ACCOUNTS = parsedBody.accounts;

			if (DEF_MODE) console.log('ACCOUNT_BALANCE', ACCOUNTS[0].balance);
		})
		.catch(function (err) {
			console.error("$$$ Error while getting all accounts.");
			console.log(err.message);
		});
	} catch (ex) {
		console.log(ex);
	}

};

const requestSEPAMoneyTransfer = (
	userToken,
	recipientName,
	recipientIban,
	amount,
	purpose,
	accountId,
	twoStepProcedureId
) => {

	let requestSEPAMoneyTransferOptions = {
		method: 'POST',
		url: usedURL + '/api/v1/accounts/requestSepaMoneyTransfer',
		body: {
			"recipientName": recipientName,
			"recipientIban": recipientIban,
			"amount": amount,
			"purpose": purpose,
			"accountId": accountId,
			"twoStepProcedureId": twoStepProcedureId
		},
		headers: {
			'content-type': 'application/json',
			'Authorization': 'Bearer ' + userToken
		},
		json: true
	};

	try {
		request(requestSEPAMoneyTransferOptions)
		.then(function (parsedBody) {

			if (DEF_MODE) console.log('SEPA REQUEST', parsedBody);
		})
		.catch(function (err) {
			console.error("$$$ Error while requesting SEPA Money Transfer.");
			console.log(err.message);
		});
	} catch (ex) {
		console.log(ex);
	}
};


// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// ++++++++++++++++++++++++++++++++++ INITIALISE ACTIONS STUFF ++++++++++++++++++++++++++++++++++++++++++
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++



/** @type {Map<string, function(ApiAiApp): void>} */
const actionMap = new Map();
actionMap.set(Actions.UNRECOGNIZED_DEEP_LINK, unhandledDeepLinks);
actionMap.set(Actions.TELL_ACCOUNT_BALANCE, tellAccountBalance);
actionMap.set(Actions.TELL_SPENDING, tellSpending);
actionMap.set(Actions.RESPOND_TO_SEPA_REQUEST, respondToSepaRequest);

/**
 * The entry point to handle a http request
 * @param {Request} request An Express like Request object of the HTTP request
 * @param {Response} response An Express like Response object to send back data
 */
const init = functions.https.onRequest((request, response) => {
	const app = new ApiAiApp({ request, response });
	
	console.log(`Request headers: ${JSON.stringify(request.headers)}`);
	console.log(`Request body: ${JSON.stringify(request.body)}`);

	authenticateClient();

	setTimeout(() => {
		app.handleRequest(actionMap);
	}, 1000)

});

module.exports = {
	init
};

if (!LIVE) {
	authenticateClient();
	setTimeout(() => {
		requestSEPAMoneyTransfer(USER_TOKEN, 'papa', ibans['papa'], 0.01, 'test', ACCOUNTS[0].id, '921');
	}, 1000);
};
