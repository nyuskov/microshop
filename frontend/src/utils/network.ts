export function getCSRFToken() {
    /*
      We get the CSRF token from the cookie to include in our requests.
      This is necessary for CSRF protection in Django.
       */
    const name = 'csrftoken'
    let cookie_value = null
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';')
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim()
            if (cookie.substring(0, name.length + 1) === name + '=') {
                cookie_value = decodeURIComponent(cookie.substring(name.length + 1))
                break
            }
        }
    }
    if (cookie_value === null) {
        throw 'Отсутствует CSRF cookie.'
    }
    return cookie_value
}

export function getAddress() {
    let host_value: string | null = null;
    if (window.location.host && window.location.host !== '') {
        host_value = window.location.host.split(':')[0] + ":8000";
    }
    return host_value
}

type BackendServer = {
    address: string | null,
    csrf_token: string,
}
export const backend_server: BackendServer = {
    address: getAddress(),
    csrf_token: getCSRFToken(),
}