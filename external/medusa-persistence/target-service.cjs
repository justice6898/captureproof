"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("@medusajs/framework/utils");
const utils_2 = require("@medusajs/utils");
const paypal_server_sdk_1 = require("@paypal/paypal-server-sdk");
class PaypalPaymentProviderService extends utils_1.AbstractPaymentProvider {
    constructor(container, options) {
        super(container, options);
        this.logger_ = container.logger;
        this.options_ = options;
        this.eventBusService_ = container.event_bus;
        if (this.options_.oAuthClientId && this.options_.oAuthClientSecret && this.options_.environment) {
            this.paypal_ = new paypal_server_sdk_1.Client({
                clientCredentialsAuthCredentials: {
                    oAuthClientId: this.options_.oAuthClientId,
                    oAuthClientSecret: this.options_.oAuthClientSecret
                },
                timeout: 0,
                environment: this.options_.environment === "sandbox" ? paypal_server_sdk_1.Environment.Sandbox : paypal_server_sdk_1.Environment.Production,
                logging: {
                    logLevel: paypal_server_sdk_1.LogLevel.Info,
                    logRequest: {
                        logBody: true
                    },
                    logResponse: {
                        logHeaders: true
                    }
                }
            });
        }
        else {
            throw new utils_2.MedusaError(utils_2.MedusaError.Types.INVALID_DATA, "oAuthClientId, oAuthClientSecret and environment are required in the provider's options.");
        }
    }
    static validateOptions(options) {
        if (!options.oAuthClientId) {
            throw new utils_2.MedusaError(utils_2.MedusaError.Types.INVALID_DATA, "oAuthClientId is required in the provider's options.");
        }
        if (!options.oAuthClientSecret) {
            throw new utils_2.MedusaError(utils_2.MedusaError.Types.INVALID_DATA, "oAuthClientSecret is required in the provider's options.");
        }
        if (options.environment !== 'production' && options.environment !== "sandbox") {
            throw new utils_2.MedusaError(utils_2.MedusaError.Types.INVALID_DATA, "environment needs to be either production or sandbox");
        }
    }
    async capturePayment(paymentData) {
        const paypalOrder = paymentData.data.paypalOrder;
        if (paypalOrder.purchaseUnits?.length &&
            paypalOrder.purchaseUnits[0].payments &&
            paypalOrder.purchaseUnits[0].payments.authorizations?.length) {
            const id = paypalOrder.purchaseUnits[0].payments.authorizations[0].id;
            try {
                const paymentsController = new paypal_server_sdk_1.PaymentsController(this.paypal_);
                await paymentsController.captureAuthorizedPayment({
                    authorizationId: id
                });
                return await this.retrievePayment(paymentData);
            }
            catch (error) {
                this.logger_.error(error);
                throw new Error("An error occurred in capturePayment");
            }
        }
        throw new Error("An error occurred in capturePayment");
    }
    async authorizePayment(paymentData) {
        try {
            const status = (await this.getPaymentStatus(paymentData)).status;
            const retrievedPayment = await this.retrievePayment(paymentData);
            return {
                data: {
                    ...paymentData,
                    paypalOrder: retrievedPayment.data.paypalOrder,
                    paypalOrderId: retrievedPayment.data.paypalOrder.id
                },
                status: status
            };
        }
        catch (error) {
            throw new Error("Authorize payment failed");
        }
    }
    async cancelPayment(paymentData) {
        const paypalOrder = paymentData.data.paypalOrder;
        if (paypalOrder.purchaseUnits?.length &&
            paypalOrder.purchaseUnits[0].payments) {
            const isAlreadyCanceled = paypalOrder.status === paypal_server_sdk_1.OrderStatus.Voided;
            const isCanceledAndFullyRefund = paypalOrder.status === paypal_server_sdk_1.OrderStatus.Completed && !!paypalOrder.purchaseUnits[0].invoiceId;
            if (isAlreadyCanceled || isCanceledAndFullyRefund) {
                return await this.retrievePayment(paymentData);
            }
            const paymentsController = new paypal_server_sdk_1.PaymentsController(this.paypal_);
            try {
                const isAlreadyCaptured = paypalOrder.purchaseUnits.some((pu => pu.payments?.captures?.length));
                if (isAlreadyCaptured) {
                    const payments = paypalOrder.purchaseUnits[0].payments;
                    const capturesId = payments.captures[0].id;
                    await paymentsController.refundCapturedPayment({
                        captureId: capturesId,
                    });
                }
                else {
                    const id = paypalOrder.purchaseUnits[0].payments.authorizations[0].id;
                    await paymentsController.voidPayment({
                        authorizationId: id
                    });
                }
                return await this.retrievePayment(paymentData);
            }
            catch (error) {
                throw new Error("An error occurred in cancelPayment");
            }
        }
        throw new Error("An error occurred in cancelPayment");
    }
    async initiatePayment(paymentData) {
        const ordersController = new paypal_server_sdk_1.OrdersController(this.paypal_);
        try {
            const { result, ...httpResponse } = await ordersController.createOrder({
                body: {
                    intent: paypal_server_sdk_1.CheckoutPaymentIntent.Authorize,
                    purchaseUnits: [
                        {
                            amount: {
                                currencyCode: paymentData.currency_code,
                                value: paymentData.amount.toString()
                            }
                        }
                    ]
                }
            });
            if (result.id) {
                return {
                    id: result.id,
                    data: {
                        ...paymentData,
                        paypalOrderId: result.id,
                        paypalOrder: result
                    }
                };
            }
        }
        catch (error) {
            if (error instanceof paypal_server_sdk_1.ApiError) {
                const { statusCode, headers } = error;
                this.logger_.error(`Status code ${statusCode.toString()}`);
                this.logger_.error(JSON.stringify(headers));
            }
        }
        throw new Error("Initialize payment failed");
    }
    async deletePayment(paymentSessionData) {
        return paymentSessionData;
    }
    async getPaymentStatus(paymentData) {
        const retrievedPayment = await this.retrievePayment(paymentData);
        const paypalOrder = retrievedPayment.data.paypalOrder;
        switch (paypalOrder.status) {
            case paypal_server_sdk_1.OrderStatus.Created:
                return {
                    status: 'pending'
                };
            case paypal_server_sdk_1.OrderStatus.Saved:
            case paypal_server_sdk_1.OrderStatus.Approved:
            case paypal_server_sdk_1.OrderStatus.PayerActionRequired:
                return {
                    status: 'requires_more'
                };
            case paypal_server_sdk_1.OrderStatus.Voided:
                return {
                    status: 'canceled'
                };
            case paypal_server_sdk_1.OrderStatus.Completed:
                return {
                    status: 'authorized'
                };
            default:
                return {
                    status: 'pending'
                };
        }
    }
    async refundPayment(paymentData) {
        const paypalOrder = paymentData.data.paypalOrder;
        if (paypalOrder.purchaseUnits?.length &&
            paypalOrder.purchaseUnits[0].payments) {
            const purchaseUnit = paypalOrder.purchaseUnits[0];
            const isAlreadyCaptured = paypalOrder.purchaseUnits.some((pu => pu.payments?.captures?.length));
            if (!isAlreadyCaptured) {
                throw new Error("Cannot refund an uncaptured payment");
            }
            const paymentId = purchaseUnit.payments?.captures[0].id;
            const currencyCode = purchaseUnit.amount?.currencyCode;
            const paymentsController = new paypal_server_sdk_1.PaymentsController(this.paypal_);
            try {
                await paymentsController.refundCapturedPayment({
                    captureId: paymentId,
                    body: {
                        amount: {
                            currencyCode: currencyCode,
                            value: paymentData.amount.value.toString()
                        }
                    }
                });
                return await this.retrievePayment(paymentData);
            }
            catch (error) {
                this.logger_.error(error);
                throw new Error("An error occurred in refundPayment");
            }
        }
        throw new Error("An error occurred in refundPayment");
    }
    async retrievePayment(paymentSessionData) {
        const ordersController = new paypal_server_sdk_1.OrdersController(this.paypal_);
        try {
            const paypalOrderId = paymentSessionData.data.paypalOrder.id;
            const { result, ...httpResponse } = await ordersController.getOrder({
                id: paypalOrderId
            });
            if (result.id) {
                return {
                    data: {
                        ...paymentSessionData,
                        paypalOrderId: result.id,
                        paypalOrder: result,
                    }
                };
            }
        }
        catch (error) {
            if (error instanceof paypal_server_sdk_1.ApiError) {
                const { statusCode, headers } = error;
                this.logger_.error(`Status code ${statusCode.toString()}`);
                this.logger_.error(JSON.stringify(headers));
                throw new Error("Initialize payment failed");
            }
        }
        throw new Error("Initialize payment failed.");
    }
    async updatePayment(context) {
        const ordersController = new paypal_server_sdk_1.OrdersController(this.paypal_);
        try {
            const paypalOrderId = context.data.paypalOrder.id;
            await ordersController.patchOrder({
                id: paypalOrderId,
                body: [
                    {
                        op: paypal_server_sdk_1.PatchOp.Replace,
                        value: {
                            amount: {
                                currencyCode: context.currency_code,
                                value: context.amount.toString()
                            }
                        }
                    }
                ]
            });
            return await this.retrievePayment(context);
        }
        catch (error) {
            this.logger_.error(error);
            throw new Error("An error occurred in updatePayment");
        }
    }
    async getWebhookActionAndData(data) {
        return {
            action: utils_1.PaymentActions.NOT_SUPPORTED
        };
    }
}
PaypalPaymentProviderService.identifier = "paypal-payment";
exports.default = PaypalPaymentProviderService;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmljZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9wcm92aWRlcnMvcGF5cGFsLXBheW1lbnQvc2VydmljZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLHFEQUFtRjtBQUVuRiwyQ0FBNkU7QUFDN0UsaUVBV2tDO0FBYWxDLE1BQU0sNEJBQTZCLFNBQVEsK0JBRTFDO0lBUUMsWUFDRSxTQUErQixFQUMvQixPQUFnQjtRQUVoQixLQUFLLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBRXpCLElBQUksQ0FBQyxPQUFPLEdBQUcsU0FBUyxDQUFDLE1BQU0sQ0FBQTtRQUMvQixJQUFJLENBQUMsUUFBUSxHQUFHLE9BQU8sQ0FBQTtRQUN2QixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsU0FBUyxDQUFDLFNBQVMsQ0FBQztRQUU1QyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsYUFBYSxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsaUJBQWlCLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUNoRyxJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksMEJBQVksQ0FBQztnQkFDOUIsZ0NBQWdDLEVBQUU7b0JBQ2hDLGFBQWEsRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLGFBQWE7b0JBQzFDLGlCQUFpQixFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsaUJBQWlCO2lCQUNuRDtnQkFDRCxPQUFPLEVBQUUsQ0FBQztnQkFDVixXQUFXLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxXQUFXLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQywrQkFBVyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsK0JBQVcsQ0FBQyxVQUFVO2dCQUNuRyxPQUFPLEVBQUU7b0JBQ1AsUUFBUSxFQUFFLDRCQUFRLENBQUMsSUFBSTtvQkFDdkIsVUFBVSxFQUFFO3dCQUNWLE9BQU8sRUFBRSxJQUFJO3FCQUNk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