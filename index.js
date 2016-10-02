'use strict';

String.prototype.replaceAll = function(search, replacement) {
	let target = this;
	return target.replace(new RegExp(search, 'g'), replacement);
};

exports.Order	= require('./order.js');
exports.Orders	= require('./orders.js');
