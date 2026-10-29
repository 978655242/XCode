# aiscoo-account-avatar

Aiscoo 默认账户头像，作为用户身份的本地展示派生值。公开固定用户 ID 到 SVG data URI 的生成器、图片组件和根包装工厂；通过 profile-avatar 的可选 fallback 插槽接入共享 UI。

固定 `@multiavatar/multiavatar@1.0.7` 的默认参数，种子为 `aiscoo:new-api:multiavatar:v1:` 加规范正十进制用户 ID。与 new-api 网页使用同一合同和固定 SVG 校验值；名字、凭据、时间、主题不进入种子。不宣称图案零碰撞。非十进制旧 OAuth 身份使用独立 `aiscoo:account:multiavatar:v1:` 命名空间，不影响现有真实头像。

生成 SVG 编码为 data URI，经图片上下文展示，不注入 HTML、不调用网络。进程内缓存最多 128 项，不持久化、不发事件、不写账号资料。图片解码错误按身份隔离，身份变化重新尝试。未知身份或解码失败显示中性用户图标。

共享 Footer 仍拥有真实头像和登录/恢复状态；本模块仅拥有生成图片的局部加载状态。根包装工厂组合已有 Root，不改变其 props、服务或认证所有者。
