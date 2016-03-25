// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation. All rights reserved.
// ----------------------------------------------------------------------------

var types = require('./utilities/types'),
    expressions = require('./expressions'),
    ExpressionVisitor = require('./ExpressionVisitor');

function ctor(tableMetadata) {
    this.tableMetadata = tableMetadata;
}

var TypeConverter = types.deriveClass(ExpressionVisitor, ctor, {
    visitBinary: function (expr) {
        var left = expr.left ? this.visit(expr.left) : null;
        var right = expr.right ? this.visit(expr.right) : null;

        if (this._isStringConstant(left) && this._isBinaryMemberAccess(right)) {
            left.value = new Buffer(left.value, 'base64');
        }
        else if (this._isStringConstant(right) && this._isBinaryMemberAccess(left)) {
            right.value = new Buffer(right.value, 'base64');
        }

        if (left != expr.left || right != expr.right) {
            return new expressions.Binary(left, right, expr.expressionType);
        }

        return expr;
    },

    _isStringConstant: function(expr) {
        return expr &&
               expr.expressionType === 'Constant' &&
               types.isString(expr.value);
    },

    _isBinaryMemberAccess: function (expr) {
        return expr &&
               expr.expressionType === 'MemberAccess' &&
               types.isString(expr.member) && // tableConfig.binaryColumns is not currently used - hard coded __version column
               ((this.tableMetadata.binaryColumns && this.tableMetadata.binaryColumns.indexOf(expr.member.toLowerCase()) > -1) || expr.member.toLowerCase() === 'version');
    }
});

module.exports = function (expr, tableMetadata) {
    return new TypeConverter(tableMetadata).visit(expr);
};
