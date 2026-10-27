(function () {
    "use strict";

    function closePopup() {
        if (window.ZOHO && ZOHO.CRM && ZOHO.CRM.UI && ZOHO.CRM.UI.Popup) {
            ZOHO.CRM.UI.Popup.close();
        } else {
            window.close();
        }
    }

    document.addEventListener("DOMContentLoaded", function () {
        var notice = document.getElementById("notice");
        if (!notice) {
            return;
        }

        var observer = new MutationObserver(function () {
            var text = String(notice.textContent || "").trim();
            if (text.indexOf("Sent successfully") === 0) {
                observer.disconnect();
                window.setTimeout(closePopup, 700);
            }
        });

        observer.observe(notice, {
            childList: true,
            characterData: true,
            subtree: true
        });
    });
}());
