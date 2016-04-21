'use strict';

const dbmigration  = require('larvitdbmigration')({'tableName': 'orders_db_version', 'migrationScriptsPath': __dirname + '/dbmigration'}),
      events       = require('events'),
      eventEmitter = new events.EventEmitter(),
      log          = require('winston');

let dbChecked = false;

dbmigration(function(err) {
	if (err) {
		log.error('larvitorder: orders.js: Database error: ' + err.message);
		return;
	}

	dbChecked = true;
	eventEmitter.emit('checked');
});

String.prototype.replaceAll = function(search, replacement) {
	let target = this;
	return target.replace(new RegExp(search, 'g'), replacement);
};

exports.Order  = require('./order.js');
exports.Orders = require('./orders.js');
