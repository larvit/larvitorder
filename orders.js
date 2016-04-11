'use strict';

var log          = require('winston'),
    events       = require('events'),
    dbmigration  = require('larvitdbmigration')({'tableName': 'orders_db_version', 'migrationScriptsPath': __dirname + '/dbmigration'}),
    eventEmitter = new events.EventEmitter(),
    dbChecked    = false;

// Handle database migrations
dbmigration(function(err) {
	if (err) {
		log.error('larvitorder: orders.js: Database error: ' + err.message);
		return;
	}

	dbChecked = true;
	eventEmitter.emit('checked');
});

function get(options, cb) {
	if ( ! dbChecked) {
		eventEmitter.on('checked', function() {get(options, cb);});
		return;
	}

	cb();
}

exports.get = get;
