'use strict';

const	orderLib	= require(__dirname + '/../../index.js'),
	async	= require('async');

exports.run = function(req, res, cb) {
	const	tasks	= [],
		data	= {'global': res.globalData};

	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) {
		cb(new Error('Invalid rights'), req, res, {});
		return;
	}

	data.global.menuControllerName = 'orders';

	tasks.push(function(cb) {
		const	orders	= new orderLib.Orders();

		orders.returnFields = ['status'];

		if (data.global.urlParsed.query.filterStatus) {
			orders.matchAllFields = {'status': data.global.urlParsed.query.filterStatus};
		}

		orders.get(function(err, result) {
			data.orders	= result;
			cb(err);
		});
	});

	tasks.push(function(cb) {
		orderLib.helpers.getFieldValues('status', function(err, result) {
			data.statuses	= result;
			cb(err, result);
		});
	});

	async.series(tasks, function(err) {
		cb(err, req, res, data);
	});
};
