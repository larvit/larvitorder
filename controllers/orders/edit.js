'use strict';

const	orderLib	= require(__dirname + '/../../index.js'),
	async	= require('async'),
	log	= require('winston');

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
		data.order = new orderLib.Order(data.global.urlParsed.query.uuid);

		data.order.loadFromDb(cb);
	});

	if (data.global.formFields.save !== undefined) {
		tasks.push(function(cb) {
			data.order.fields	= {};
			data.order.rows	= [];

			// Handle order fields
			for (let i = 0; data.global.formFields.fieldName[i] !== undefined; i ++) {
				const	fieldName	= data.global.formFields.fieldName[i],
					fieldValue	= data.global.formFields.fieldValue[i];

				if (fieldName && fieldValue !== undefined) {
					if (data.order.fields[fieldName] === undefined) {
						data.order.fields[fieldName] = [];
					}

					data.order.fields[fieldName].push(fieldValue);
				}
			}

			// Handle order rows
			for (const rowUuid of Object.keys(data.global.formFields.rowFieldName)) {
				const	row	= {};

				if (rowUuid !== 'new') {
					row.uuid = rowUuid;
				}

				for (let i = 0; data.global.formFields.rowFieldName[rowUuid][i] !== undefined; i ++) {
					const	rowFieldName	= data.global.formFields.rowFieldName[rowUuid][i],
						rowFieldValue	= data.global.formFields.rowFieldValue[rowUuid][i];

					if (rowFieldName && rowFieldValue !== undefined) {
						if (row[rowFieldName] === undefined) {
							row[rowFieldName] = [];
						}

						row[rowFieldName].push(rowFieldValue);
					}
				}

				data.order.rows.push(row);
			}

			data.order.save(function(err) {
				if (err) { cb(err); return; }

				if (data.order.uuid !== undefined && data.global.urlParsed.query.uuid === undefined) {
					log.verbose('larvitorder: ./controllers/orders/edit.js: run() - New order created, redirect to new uuid: "' + data.order.uuid + '"');
					req.session.data.nextCallData	= {'global': {'messages': ['New order created']}};
					res.statusCode	= 302;
					res.setHeader('Location', '/orders/edit?uuid=' + data.order.uuid);
				} else {
					data.global.messages = ['Saved'];
				}

				cb();
			});
		});
	}

	async.series(tasks, function(err) {
		cb(err, req, res, data);
	});
};
