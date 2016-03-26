// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation. All rights reserved.
// ----------------------------------------------------------------------------

var types = require('./utilities/types');

var Expression = types.defineClass(
    null, {
        accept: function (visitor) {
            return visitor.visit(this);
        }
    },
    null);

module.exports = {
    MappedMemberInfo: types.defineClass(
        function (type, memberName, isStatic, isMethod) {
            this.type = type;
            this.memberName = memberName;
            this.isStatic = isStatic;
            this.isMethod = isMethod;
        }, null, null),

    Constant: types.deriveClass(
        Expression,
        function (value) {
            this.value = value;
            this.expressionType = 'Constant';
        }, {
            accept: function (visitor) {
                return visitor.visitConstant(this);
            }
        },
        null),

    FloatConstant: types.deriveClass(
        Expression,
        function (value) {
            this.value = value;
            this.expressionType = 'FloatConstant';
        }, {
            accept: function (visitor) {
                return visitor.visitFloatConstant(this);
            }
        },
        null),

    Binary: types.deriveClass(
        Expression,
        function (left, right, expressionType) {
            this.left = left;
            this.right = right;
            this.expressionType = expressionType;
        }, {
            accept: function (visitor) {
                return visitor.visitBinary(this);
            }
        },
        null),

    Unary: types.deriveClass(
        Expression,
        function (operand, expressionType) {
            this.operand = operand;
            this.expressionType = expressionType;
        }, {
            accept: function (visitor) {
                return visitor.visitUnary(this);
            }
        },
        null),

    Member: types.deriveClass(
        Expression,
        // member may be either a member name or a MappedMemberInfo
        function (instance, member) {
            this.instance = instance;
            this.member = member;
            this.expressionType = 'MemberAccess';
        }, {
            accept: function (visitor) {
                return visitor.visitMember(this);
            }
        },
        null),

    FunctionCall: types.deriveClass(
        Expression,
        function (instance, memberInfo, args) {
            this.instance = instance;
            this.memberInfo = memberInfo;
            this.args = args;
            this.expressionType = 'Call';
        }, {
            accept: function (visitor) {
                return visitor.visitFunction(this);
            }
        },
        null),

    Parameter: types.defineClass(
        function () {
            this.ExpressionType = 'Parameter';
        }, {
            accept: function (visitor) {
                return visitor.visitParameter(this);
            }
        },
        null),

    Convert: types.deriveClass(
        Expression,
        function (desiredType, operand) {
            this.desiredType = desiredType;
            this.operand = operand;
            this.expressionType = 'Convert';
        }, {
            accept: function (visitor) {
                return visitor.visitUnary(this);
            }
        },
        null)
};
