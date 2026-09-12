function Logger() {}

Logger.prototype.message = function (message, prefix) {
    const d   = new Date();
    const str = (message instanceof Error)
        ? (message.stack || message.message)
        : String(message);
    console.log(`${d.toLocaleDateString()} [${d.toLocaleTimeString()}] [${prefix}]: ${str}`);
};

Logger.info  = function (m) { Logger.prototype.message(m, 'THÔNG TIN'); };
Logger.log   = Logger.info;
Logger.warn  = function (m) { Logger.prototype.message(m, 'CẢNH BÁO');  };
Logger.error = function (m) { Logger.prototype.message(m, 'LỖI');       };

module.exports = Logger;
