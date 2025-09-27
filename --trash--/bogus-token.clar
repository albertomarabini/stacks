;; -------------------------------------------------------------------
;; Bogus FT contract: minimal SIP-010 stub for wrong-token test (u307)
;; -------------------------------------------------------------------
;; This implements the same `ft-trait` defined in sbtc-payment,
;; so that it can be passed as an <ft-trait> arg. It never transfers,
;; always returns (ok false). Used only as an "alt token" in tests.
;; -------------------------------------------------------------------

;; Import the trait definition from the sbtc-payment contract
(impl-trait .sbtc-payment.ft-trait)

;; ---------------------------- Public --------------------------------

;; Satisfies the required transfer fn but does nothing useful
(define-public (transfer (amount uint)
                         (sender principal)
                         (recipient principal)
                         (memo (optional (buff 34))))
  (ok false)
)

;; ---------------------------- Optional ------------------------------
;; If you want to expose some harmless read-onlys for clarity console:

(define-read-only (get-name)   "BOGUS")
(define-read-only (get-symbol) "BG")
