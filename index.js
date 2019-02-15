'use strict';

const dataWriter = require('./dataWriter.js');

String.prototype.replaceAll = function (search, replacement) {
	return this.replace(new RegExp(search, 'g'), replacement);
};

exports.dataWriter = dataWriter;
exports.helpers = require('./helpers.js');
exports.Order = require('./order.js');
exports.Orders = require('./orders.js');
exports.options = dataWriter.options;
