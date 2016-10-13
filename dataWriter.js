'use strict';

const	exchangeName	= 'larvitorder',
	EventEmitter	= require('events').EventEmitter,
	intercom	= require('larvitutils').instances.intercom,
	lUtils	= require('larvitutils'),
	log	= require('winston'),
	db	= require('larvitdb');

function årder(params, deliveryTag) {
	const	dbFields	= [],
		sql	= 'INSERT INTO user_users (uuid, username, password) VALUES(?,?,?) ON DUPLICATE KEY UPDATE username = ?, password = ?;';

	let	userUuid,
		username,
		password,
		userData;

	if ( ! (params instanceof Array) || params.length !== 4) {
		const	err	= new Error('invalid params, is not an array of four for deliveryTag: "' + deliveryTag + '"');
		log.warn('larvitorder: dataWriter.js - createUser() - ' + err.message);
		exports.emit('userCreate', err);
		return;
	}

	userUuid	= params[0];
	username	= params[1];
	password	= params[2];
	userData	= params[3];

	if (lUtils.formatUuid(userUuid) === false) {
		const	err	= new Error('invalid user uuid: "' + userUuid + '" for deliveryTag: "' + deliveryTag + '"');
		log.warn('larvitorder: dataWriter.js - createUser() - ' + err.message);
		exports.emit('userCreate', err, userUuid);
		return;
	}

	dbFields.push(userUuid);
	dbFields.push(username);
	dbFields.push(password);
	dbFields.push(username);
	dbFields.push(password);

	db.query(sql, dbFields, function(err) {
		if (err) {
			exports.emit('userCreate', err, userUuid);
			return;
		}

		exports.emit('userCreate', null, userUuid);
	});
};

module.exports	= new EventEmitter();
exports	= module.exports;
exports.createUser	= createUser;

intercom.subscribe({'exchange': exchangeName}, function(message, ack, deliveryTag) {
	ack(); // Ack first, if something goes wrong we log it and handle it manually

	if (typeof message !== 'object') {
		log.error('larvitorder: dataWriter.js - intercom.subscribe() - Invalid message received, is not an object! deliveryTag: "' + deliveryTag + '"');
		return;
	}

	if (typeof exports[message.action] === 'function') {
		exports[message.action](message.params, deliveryTag);
	} else {
		log.warn('larvitorder: dataWriter.js - intercom.subscribe() - Unknown message.action received: "' + message.action + '"');
	}
});
