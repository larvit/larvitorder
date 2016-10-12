'use strict';

exports.run = function(req, res, cb) {
	const	data	= {'global': res.globalData};

	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) {
		cb(new Error('Invalid rights'), req, res, {});
		return;
	}

	data.global.menuControllerName = 'orders';

	cb(null, req, res, data);
};
