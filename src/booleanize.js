// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation. All rights reserved.
// ----------------------------------------------------------------------------

var types = require('./utilities/types'),
    ExpressionVisitor = require('./ExpressionVisitor'),
    expressions = require('./expressions');

var SqlBooleanizer = types.deriveClass(ExpressionVisitor, null, {
    visitUnary: function (expr) {
        var operand = this.visit(expr.operand);

        if (operand && expr.expressionType == 'Not') {
            // Convert expression 'x' to a boolean expression '(x = true)' since
            // the SQL Not operator requires a boolean expression (not a BIT)
            return new expressions.Unary(ensureExpressionIsBoolean(operand), 'Not');
        }

        if (operand != expr.operand) {
            return new expressions.Unary(operand, expr.expressionType);
        }

        return expr;
    },

    visitBinary: function (expr) {
        var left = null;
        var right = null;

        // first visit the expressions to do any sub conversions, before
        // doing any transformations below
        if (expr.left !== null) {
            left = this.visit(expr.left);
        }
        if (expr.right !== null) {
            right = this.visit(expr.right);
        }

        if ((expr.expressionType == 'And') || (expr.expressionType == 'Or')) {
            // both operands must be boolean expressions
            left = ensureExpressionIsBoolean(left);
            right = ensureExpressionIsBoolean(right);
        }
        else if ((expr.expressionType == 'Equal') || (expr.expressionType == 'NotEqual')) {
            // remove any comparisons between boolean and bit
            var converted = rewriteBitComparison(left, right);
            if (converted) {
                return converted;
            }
        }

        if (left != expr.left || right != expr.right) {
            return new expressions.Binary(left, right, expr.expressionType);
        }

        return expr;
    }
});

// if a boolean expression is being compared to a bit expression, convert
// by removing the comparison. E.g. (endswith('value', title) eq false) => not(endswith('value', title))
function rewriteBitComparison(left, right) {
    if (isBooleanExpression(left) && isBitConstant(right)) {
        return (right.value === true) ? left : new expressions.Unary(left, 'Not');
    }
    else if (isBooleanExpression(right) && isBitConstant(left)) {
        return (left.value === true) ? right : new expressions.Unary(right, 'Not');
    }

    // no conversion necessary
    return null;
}

// returns true if the expression is the constant 'true' or 'false'
function isBitConstant(expr) {
    return (expr.expressionType == 'Constant') && (expr.value === true || expr.value === false);
}

// if the expression isn't boolean, convert to a boolean expression (e.g. (isDiscontinued) => (isDiscontinued = 1))
function ensureExpressionIsBoolean(expr) {
    if (!isBooleanExpression(expr)) {
        return new expressions.Binary(expr, new expressions.Constant(true), 'Equal');
    }
    return expr;
}

function isBooleanExpression(expr) {
    if (!expr) {
        return false;
    }

    // see if this is a logical boolean expression
    switch (expr.expressionType) {
        case 'And':
        case 'Or':
        case 'GreaterThan':
        case 'GreaterThanOrEqual':
        case 'LessThan':
        case 'LessThanOrEqual':
        case 'Not':
        case 'Equal':
        case 'NotEqual':
            return true;
        default:
            break;
    }

    // boolean odata functions
    if (expr.expressionType == 'Call') {
        switch (expr.memberInfo.memberName) {
            case 'startswith':
            case 'endswith':
            case 'substringof':
                return true;
            default:
                break;
        }
    }

    return false;
}

module.exports = function (expr) {
    var booleanizer = new SqlBooleanizer();

    expr = booleanizer.visit(expr);
    expr = ensureExpressionIsBoolean(expr);

    return expr;
};
