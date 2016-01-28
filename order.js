'use strict';

var db           = require('larvitdb'),
    log          = require('winston'),
    async        = require('async'),
    utils        = require('larvitutils'),
    orders       = require('./orders.js'),
    events       = require('events'),
    dbmigration  = require('larvitdbmigration')({'tableName': 'blog_db_version', 'migrationScriptsPath': __dirname + '/dbmigration'}),
    eventEmitter = new events.EventEmitter(),
    dbChecked    = false;

// Handle database migrations
dbmigration(function(err) {
	if (err) {
		log.error('larvitorder: order.js: Database error: ' + err.message);
		return;
	}

	dbChecked = true;
	eventEmitter.emit('checked');
});

/**
 * Create a new order
 *
 * @param obj data - Free form key-value object. However these fields have special meaning:
 *                   uuid - Must be a valid uuid string or buffer. If not supplied it will be generated
 *                   rows - Must be an array with order rows, each row containing at least "name" and "price"
 *                   createdTime - Must be a date object. If not supplied will be new Date()
 * @param func cb(err, orderObj)
 */
function create(data, cb) {
	if ( ! dbChecked) {
		eventEmitter.on('checked', function() {create(data, cb);});
		return;
	}

	cb();
}

/**
 * Get an order object
 *
 * @param uuid uuid
 * @return obj or err
 */
function get(uuid) {
	var retObj = {'uuid': utils.formatUuid(uuid)},
	    err;

	if ( ! retObj.uuid) {
		err = new Error('Invalid order uuid supplied: "' + uuid + '"');
		log.error('larvitorder: order.js: get() - ' + err.message);
		return err;
	}

	retObj.getData = function(cb) {
		orders.get({'ids': retObj.id}, function(err, data) {
			if ( ! err)
				retObj.data = data;

			cb(err, retObj.data);
		});
	};

	return retObj;
}

exports.create = create;
exports.get    = get;