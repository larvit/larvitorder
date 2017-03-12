'use strict';

const	orderLib	= require(__dirname + '/../../index.js'),
	async	= require('async');

exports.run = function (req, res, cb) {
	const	tasks	= [],
		data	= {'global': res.globalData};

	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) {
		cb(new Error('Invalid rights'), req, res, {});
		return;
	}

	data.global.menuControllerName	= 'orders';
	data.pagination	= {};
	data.pagination.urlParsed	= data.global.urlParsed;
	data.pagination.elementsPerPage	= 100;

	tasks.push(function (cb) {
		const	orders	= new orderLib.Orders();

		orders.returnFields	= ['status'];
		orders.limit	= data.pagination.elementsPerPage;
		orders.offset	= parseInt(data.global.urlParsed.query.offset)	|| 0;

		if (isNaN(orders.offset) || orders.offset < 0) {
			orders.offset = 0;
		}

		if (data.global.urlParsed.query.filterStatus) {
			orders.matchAllFields = {'status': data.global.urlParsed.query.filterStatus};
		}

		orders.get(function (err, result, totalElements) {
			data.orders	= result;
			data.pagination.totalElements	= totalElements;
			cb(err);
		});
	});

	tasks.push(function (cb) {
		orderLib.helpers.getFieldValues('status', function (err, result) {
			data.statuses	= result;
			cb(err, result);
		});
	});

	async.series(tasks, function (err) {
		cb(err, req, res, data);
	});
};
