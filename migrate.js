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

function ready(cb) {
	if (dbChecked) {
		cb();
		return;
	}

	eventEmitter.on('checked', cb);
}

exports.ready = ready;
