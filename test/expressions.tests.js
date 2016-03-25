// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation. All rights reserved.
// ----------------------------------------------------------------------------
var expressions = require('../src/expressions'),
    equal = require('assert').equal;

describe('azure-odata-sql.expressions', function () {
    it("constant expression test", function () {
        var constExpr = new expressions.Constant('hello');
        equal(constExpr.value, 'hello');
        equal(constExpr.expressionType, 'Constant');
    });

    it("basic expression tree test", function () {
        var p = new expressions.Parameter();
        var left = new expressions.Member(p, 'user');
        var right = new expressions.Constant('mathewc');
        var binExpr = new expressions.Binary(left, right, 'Equal');

        equal(binExpr.left.member, 'user');
        equal(binExpr.right.value, 'mathewc');
        equal(binExpr.expressionType, 'Equal');
    });
});
