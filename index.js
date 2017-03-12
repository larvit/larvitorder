'use strict';

String.prototype.replaceAll = function (search, replacement) {
	let target = this;
	return target.replace(new RegExp(search, 'g'), replacement);
};

exports.dataWriter	= require('./dataWriter.js');
exports.helpers	= require('./helpers.js');
exports.Order	= require('./order.js');
exports.Orders	= require('./orders.js');

exports.ready	= exports.dataWriter.ready;
