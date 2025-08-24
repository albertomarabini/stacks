;; contracts/mock-sbtc-token.clar
;; Minimal FT for testing: supports balances + transfer? + mint (test only).

(define-trait ft-trait
  ((transfer? (uint principal principal (optional (buff 34))) (response bool uint)))
)

(define-map balances
  { who: principal }
  { bal: uint }
)

(define-private (get-balance (who principal))
  (default-to u0 (get bal (unwrap! (map-get? balances { who: who }) { bal: u0 })))
)

(define-private (set-balance (who principal) (amt uint))
  (begin
    (map-set balances { who: who } { bal: amt })
    (ok true)
  )
)

;; test helper: mint to an address
(define-public (mint (to principal) (amount uint))
  (let ((cur (get-balance to)))
    (begin
      (set-balance to (+ cur amount))
      (ok true)
    )
  )
)

;; SIP-010-like transfer?
(define-public (transfer? (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (> amount u0) (err u100))
    (let ((sb (get-balance sender)))
      (begin
        (asserts! (>= sb amount) (err u101))
        (set-balance sender (- sb amount))
        (set-balance recipient (+ (get-balance recipient) amount))
        (ok true)
      )
    )
  )
)

;; view for debugging (not required)
(define-read-only (balance-of (who principal)) (get-balance who))
