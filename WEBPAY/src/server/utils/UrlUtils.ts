export function resolveServerBaseUrl(req: any): string {
    // 1) explicit env override
    const envBase = process.env.BASE_URL;
    if (envBase && typeof envBase === 'string' && envBase.trim() !== '') {
        return envBase.replace(/\/+$/, ''); // strip trailing slash(es)
    }

    // 2) prefer forwarded proto if app sits behind proxy/load-balancer (make sure `app.set('trust proxy', true)` if you rely on this)
    const forwardedProto = req.get && (req.get('x-forwarded-proto') || req.headers['x-forwarded-proto']);
    const protocol = forwardedProto ? forwardedProto.split(',')[0].trim() : (req.protocol || 'http');

    // 3) host header includes host[:port]
    const host = req.get ? req.get('host') : (req.headers && (req.headers.host || req.headers.Host));
    const hostPart = typeof host === 'string' ? host : 'localhost';

    return `${protocol}://${hostPart}`.replace(/\/+$/, '');
}
