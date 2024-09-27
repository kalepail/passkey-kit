"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.create = createFetchClient;
exports.fetchClient = void 0;
var _feaxios = _interopRequireDefault(require("feaxios"));
var _types = require("./types");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
class InterceptorManager {
  handlers = [];
  use(fulfilled, rejected) {
    this.handlers.push({
      fulfilled,
      rejected
    });
    return this.handlers.length - 1;
  }
  eject(id) {
    if (this.handlers[id]) {
      this.handlers[id] = null;
    }
  }
  forEach(fn) {
    this.handlers.forEach(h => {
      if (h !== null) {
        fn(h);
      }
    });
  }
}
function getFormConfig(config) {
  const formConfig = config || {};
  formConfig.headers = new Headers(formConfig.headers || {});
  formConfig.headers.set('Content-Type', 'application/x-www-form-urlencoded');
  return formConfig;
}
function createFetchClient(fetchConfig = {}) {
  const defaults = {
    ...fetchConfig,
    headers: fetchConfig.headers || {}
  };
  const instance = _feaxios.default.create(defaults);
  const requestInterceptors = new InterceptorManager();
  const responseInterceptors = new InterceptorManager();
  const httpClient = {
    interceptors: {
      request: requestInterceptors,
      response: responseInterceptors
    },
    defaults: {
      ...defaults,
      adapter: config => instance.request(config)
    },
    create(config) {
      return createFetchClient({
        ...this.defaults,
        ...config
      });
    },
    makeRequest(config) {
      return new Promise((resolve, reject) => {
        const abortController = new AbortController();
        config.signal = abortController.signal;
        if (config.cancelToken) {
          config.cancelToken.promise.then(() => {
            abortController.abort();
            reject(new Error('Request canceled'));
          });
        }

        // Apply request interceptors
        let modifiedConfig = config;
        if (requestInterceptors.handlers.length > 0) {
          const chain = requestInterceptors.handlers.filter(interceptor => interceptor !== null).flatMap(interceptor => [interceptor.fulfilled, interceptor.rejected]);
          for (let i = 0, len = chain.length; i < len; i += 2) {
            const onFulfilled = chain[i];
            const onRejected = chain[i + 1];
            try {
              if (onFulfilled) modifiedConfig = onFulfilled(modifiedConfig);
            } catch (error) {
              if (onRejected) onRejected?.(error);
              reject(error);
              return;
            }
          }
        }
        const adapter = modifiedConfig.adapter || this.defaults.adapter;
        if (!adapter) {
          throw new Error('No adapter available');
        }
        let responsePromise = adapter(modifiedConfig).then(axiosResponse => {
          // Transform AxiosResponse to HttpClientResponse
          const httpClientResponse = {
            data: axiosResponse.data,
            headers: axiosResponse.headers,
            // You might want to transform headers more carefully
            config: axiosResponse.config,
            status: axiosResponse.status,
            statusText: axiosResponse.statusText
          };
          return httpClientResponse;
        });

        // Apply response interceptors
        if (responseInterceptors.handlers.length > 0) {
          const chain = responseInterceptors.handlers.filter(interceptor => interceptor !== null).flatMap(interceptor => [interceptor.fulfilled, interceptor.rejected]);
          for (let i = 0, len = chain.length; i < len; i += 2) {
            responsePromise = responsePromise.then(response => {
              const fulfilledInterceptor = chain[i];
              if (typeof fulfilledInterceptor === 'function') {
                return fulfilledInterceptor(response);
              }
              return response;
            }, error => {
              const rejectedInterceptor = chain[i + 1];
              if (typeof rejectedInterceptor === 'function') {
                return rejectedInterceptor(error);
              }
              throw error;
            }).then(interceptedResponse => interceptedResponse);
          }
        }

        // Resolve or reject the final promise
        responsePromise.then(resolve).catch(reject);
      });
    },
    get(url, config) {
      return this.makeRequest({
        ...this.defaults,
        ...config,
        url,
        method: 'get'
      });
    },
    delete(url, config) {
      return this.makeRequest({
        ...this.defaults,
        ...config,
        url,
        method: 'delete'
      });
    },
    head(url, config) {
      return this.makeRequest({
        ...this.defaults,
        ...config,
        url,
        method: 'head'
      });
    },
    options(url, config) {
      return this.makeRequest({
        ...this.defaults,
        ...config,
        url,
        method: 'options'
      });
    },
    post(url, data, config) {
      return this.makeRequest({
        ...this.defaults,
        ...config,
        url,
        method: 'post',
        data
      });
    },
    put(url, data, config) {
      return this.makeRequest({
        ...this.defaults,
        ...config,
        url,
        method: 'put',
        data
      });
    },
    patch(url, data, config) {
      return this.makeRequest({
        ...this.defaults,
        ...config,
        url,
        method: 'patch',
        data
      });
    },
    postForm(url, data, config) {
      const formConfig = getFormConfig(config);
      return this.makeRequest({
        ...this.defaults,
        ...formConfig,
        url,
        method: 'post',
        data
      });
    },
    putForm(url, data, config) {
      const formConfig = getFormConfig(config);
      return this.makeRequest({
        ...this.defaults,
        ...formConfig,
        url,
        method: 'put',
        data
      });
    },
    patchForm(url, data, config) {
      const formConfig = getFormConfig(config);
      return this.makeRequest({
        ...this.defaults,
        ...formConfig,
        url,
        method: 'patch',
        data
      });
    },
    CancelToken: _types.CancelToken,
    isCancel: value => value instanceof Error && value.message === 'Request canceled'
  };
  return httpClient;
}
const fetchClient = exports.fetchClient = createFetchClient();