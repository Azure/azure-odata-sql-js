// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation. All rights reserved.
// ----------------------------------------------------------------------------
var parse = require('../src/parseOData'),
    equal = require('assert').equal;

describe('azure-odata-sql.parseOData', function () {
    it("basic parser test", function () {
        var result = parse("(user eq 'mathewc')");

        equal(result.expressionType, 'Equal');
        equal(result.left.member, 'user');
        equal(result.right.value, 'mathewc');
    });

    // bug 740863: backslash should not be escape character
    it("parse backslash", function () {
        var result = parse("(user eq 'hasan\\')");

        equal(result.expressionType, 'Equal');
        equal(result.left.member, 'user');
        equal(result.right.value, 'hasan\\');
    });

    it("parse positive / negative numbers", function () {
        var result = parse('(val eq -1.5)');
        equal(result.right.value, -1.5);

        result = parse('(val eq -1)');
        equal(result.right.value, -1);

        result = parse('(val eq 1)');
        equal(result.right.value, 1);

        result = parse('(val eq 1.5)');
        equal(result.right.value, 1.5);
    });

    // verify that the odata literal type suffixes are parsed correctly, even
    // though the values actually map to the same number type
    it("numeric literal parsing", function () {
        var testCases = [
            // long literal
            { expr: '1234', value: 1234, type: 'Constant' },
            { expr: '1234L', value: 1234, type: 'Constant' },
            { expr: '1234l', value: 1234, type: 'Constant' },

            // decimal literal
            { expr: '1234M', value: 1234 },
            { expr: '1234.56M', value: 1234.56 },
            { expr: '1234.56m', value: 1234.56 },

            // single literal
            { expr: '1234F', value: 1234 },
            { expr: '1234.56f', value: 1234.56 },
            { expr: '1234.56f', value: 1234.56 },

            // double literal
            { expr: '1234D', value: 1234 },
            { expr: '1234.56d', value: 1234.56 },
            { expr: '1234.56D', value: 1234.56 }
        ];

        for (var i = 0; i < testCases.length; i++) {
            var testCase = testCases[i];
            var expr = parse(testCase.expr);
            equal(expr.expressionType, testCase.type || 'FloatConstant');
            equal(expr.value, testCase.value);
        }
    });

    it("string replace - nested calls disallowed", function () {
        var expectedExceptionCaught = false;
        try {
            parse("replace(replace(name, 'x', 'y'), 'x', 'y') eq 'ApplePie'");
        }
        catch (e) {
            expectedExceptionCaught = true;
            equal(e.message, "Calls to 'replace' cannot be nested. (at index 8)");
        }
        equal(expectedExceptionCaught, true);
    });

    it("string replace - replace arg must be constant with valid length", function () {
        var expectedExceptionCaught = false;
        try {
            // try to specify a non-constant for the replace value
            parse("replace(name, 'x', nonConstant) eq 'ApplePie'");
        }
        catch (e) {
            expectedExceptionCaught = true;
            equal(e.message, "The third parameter to 'replace' must be a string constant less than 100 in length. (at index 32)");
        }
        equal(expectedExceptionCaught, true);

        expectedExceptionCaught = false;
        try {
            // try to specify a string greater than 100 characters in length
            parse("replace(name, 'x', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx') eq 'ApplePie'");
        }
        catch (e) {
            expectedExceptionCaught = true;
            equal(e.message, "The third parameter to 'replace' must be a string constant less than 100 in length. (at index 124)");
        }
        equal(expectedExceptionCaught, true);
    });

    it("parse error double quotes", function () {
        // try a parse failure case
        var expectedExceptionCaught = false;
        try {
            parse('user eq "mathewc"');
        }
        catch (e) {
            expectedExceptionCaught = true;
            equal(e.message, "Syntax error '\"' (at index 8)");
        }
        equal(expectedExceptionCaught, true);
    });
})
