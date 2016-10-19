'use strict';

const	orderLib	= require(__dirname + '/../../index.js');

exports.run = function(req, res, cb) {
	const	orders	= new orderLib.Orders(),
		data	= {'global': res.globalData};

	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) {
		cb(new Error('Invalid rights'), req, res, {});
		return;
	}

	data.global.menuControllerName = 'orders';

	orders.returnFields = ['status'];

	orders.get(function(err, result) {
		data.orders	= result;
		cb(err, req, res, data);
	});
};
