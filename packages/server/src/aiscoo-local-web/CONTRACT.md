# Aiscoo 本机 Web 安全边界

`createHttpServer` 可选接入本模块，默认关闭。每个中间件实例独占内存会话；不存储账号凭据，不记录请求 URL 或令牌。

启用时必须监听显式回环 IP，并提供精确的 HTTP 页面 origin（含端口）；不允许同时使用旧认证 token。入口先校验原始 Host、Origin 和 Fetch Metadata，再判定本机会话。页面以无正文的同源 POST `/api/local-web/session` 建立短期会话并在内存持有响应令牌；会话绑定请求 Host，过期及进程重启后失效，重新 POST 可更新。令牌不使用 cookie，避免浏览器自动将其发送给同一主机的其他端口。

`/api` 和非安全方法以专用请求头携带有效令牌；WebSocket 在握手子协议列表中携带令牌，服务端不回显令牌作为选定协议。WebSocket、非安全方法必须带与 Host 精确匹配的 Origin。静态 GET 可无令牌；所有路径均受 Host 和跨站来源校验。本机首页的受保护 HTTP 调用为 `/api/server-info`；Host capability 和 bot webhook 虽不是首页调用，仍须通过相同边界。会话到期主动断开相关 WebSocket，页面提示重载后建立新会话。开发代理必须保留 Host 和 Origin，上游关闭模式不经过本模块。

该中间件独占连接准入：握手后附着时再次检查会话，RPC 初始化前仅允许已附着且仍有效的 WebSocket；过期或被淘汰的连接即使已完成升级也不得建立 RPC 或连接 scope。普通 Server 和未启用本模块的 `/ws/host` 维持原有行为。

该边界防止普通跨源网页访问及浏览器向其他端口自动附带令牌，不隔离恶意本机进程：同机进程可连接 loopback 并伪造 Host、Origin 和 Fetch Metadata 获取新会话。
