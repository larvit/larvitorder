'use strict';

const dataWriter = require('./dataWriter.js');

String.prototype.replaceAll = function (search, replacement) {
	let target = this;
	return target.replace(new RegExp(search, 'g'), replacement);
};

exports.dataWriter	= dataWriter;
exports.helpers	= require('./helpers.js');
exports.Order	= require('./order.js');
exports.Orders	= require('./orders.js');
exports.ready	= exports.dataWriter.ready;
exports.options	= dataWriter.options;