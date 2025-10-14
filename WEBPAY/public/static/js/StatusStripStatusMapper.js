// src/client/islands/helpers/StatusStripStatusMapper.ts
var StatusStripStatusMapper = class {
  static statusToDisplay(status) {
    switch (status) {
      case "unpaid":
        return "Awaiting payment";
      case "paid":
        return "Paid \u2713";
      case "partially_refunded":
        return "Partially Refunded";
      case "refunded":
        return "Refunded";
      case "canceled":
        return "Canceled";
      case "expired":
        return "Expired";
      default:
        return "Unknown";
    }
  }
  static statusToClasses(status) {
    switch (status) {
      case "unpaid":
        return "bg-yellow-50 text-yellow-800 border-yellow-200";
      case "paid":
        return "bg-green-50 text-green-800 border-green-200";
      case "partially_refunded":
      case "refunded":
        return "bg-blue-50 text-blue-800 border-blue-200";
      case "canceled":
      case "expired":
        return "bg-gray-50 text-gray-800 border-gray-200";
      default:
        return "bg-red-50 text-red-800 border-red-200";
    }
  }
  static isTerminalStatus(status) {
    return status === "paid" || status === "expired" || status === "canceled";
  }
};
export {
  StatusStripStatusMapper
};
//# sourceMappingURL=StatusStripStatusMapper.js.map
