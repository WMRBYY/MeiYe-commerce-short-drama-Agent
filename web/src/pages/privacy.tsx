import type { ReactNode } from "react";
import { Link } from "react-router";

const contact = "test-user-1d5d61@example.invalid";

export default function PrivacyPage() {
    return (
        <main className="min-h-screen bg-[#f7f8fb] px-4 py-10 text-slate-800 sm:px-6 sm:py-16">
            <article className="mx-auto max-w-3xl rounded-2xl bg-white px-6 py-9 shadow-sm ring-1 ring-slate-200 sm:px-12 sm:py-12">
                <Link to="/" className="text-sm text-blue-700 hover:underline">返回首页</Link>
                <h1 className="mt-7 text-3xl font-semibold tracking-tight">隐私说明</h1>
                <p className="mt-4 leading-7 text-slate-600">运营主体：天长星颜智创网络技术工作室（个体工商户）</p>
                <p className="leading-7 text-slate-600">联系邮箱：<a className="text-blue-700 hover:underline" href={`mailto:${contact}`}>{contact}</a></p>
                <p className="mt-8 leading-7">本说明介绍 MeiyeAI 当前运行的账号、创作与安全功能涉及的信息处理。</p>

                <Section title="我们处理哪些信息、用于什么目的">
                    <p>管理员账号使用用户名、密码摘要和登录会话信息，用于身份验证、维持登录状态及权限控制。系统保存用户创建的画布、作品、上传资源、任务记录及相关配置，以提供创作、保存、恢复和管理功能。用户主动创建分享链接时，系统按分享设置提供对应内容的访问。</p>
					<p>使用手机号验证码登录时，我们会处理你提交的中国大陆手机号、验证码核验请求和相关的请求 IP，用于短信发送、身份核验、登录注册及防止滥用。手机号会存入站点用户记录；阿里云号码认证服务负责生成、发送和核验验证码。本站不保存明文验证码，Redis 保存短时效的一次性票据及手机号摘要。短信服务不可用时不会发起短信请求。</p>
					<p>使用微信网站应用扫码登录时，只有你主动点击微信登录并在微信确认授权，本站才会通过微信开放平台取得该网站应用下的身份标识（OpenID），用于登录、注册或按你主动操作绑定已有账号。授权过程使用短时效的一次性状态；本站不依据微信昵称或头像自动合并手机号账号。微信平台也会按其规则处理扫码授权信息；入口不可用时，本站不会发起微信授权。</p>
                    <p>服务还会处理访问 IP、请求时间、请求路径、操作结果等运行与安全日志，用于故障排查、滥用防护和登录限流。浏览器使用必要的会话 Cookie；画布编辑过程中也可能使用浏览器本地存储保存尚未同步的状态。</p>
                </Section>

                <Section title="存储、备份和保存规则">
                    <p>网站部署在腾讯云服务器，账号与业务数据存储在该服务器及其数据库、持久化存储中。服务器执行本地定时备份，并保留已制作的加密异机备份；阿里云 OSS 每日自动备份目前暂缓。备份可能包含当时的账号及作品数据；当前没有经验证的机制能在处理单个账号删除申请时同步清除全部历史备份。</p>
                    <p>我们按提供服务、保障安全及履行适用法定义务所需的范围处理信息。现有系统没有对所有数据类别统一生效的固定保存期限或自动清除机制；具体删除申请会结合实际数据位置、备份轮换和法定义务人工核查处理，不承诺即时从所有副本删除。</p>
                </Section>

                <Section title="创作、支付及相关服务">
                    <p>当你主动使用电商 Agent、画布助手、图片或视频生成等功能时，系统会按任务需要向相应模型或处理服务提交提示词、你选择的参考素材及必要的任务参数，以完成创作请求。请避免在创作输入中包含无关的个人信息或敏感资料。</p>
                    <p>当你主动使用充值或其他支付功能时，系统会按支付流程向相应支付服务提交完成交易所必需的订单信息，并处理支付结果，用于订单核对和积分记录。具体可用方式与处理内容以页面展示及你的实际操作为准。</p>
                </Section>

                <Section title="你的申请与联系渠道">
                    <p>如需查阅、复制、转移、更正、补充、删除或限制处理个人信息，申请注销账号、撤销分享、撤回同意，或提出投诉，请发送邮件至 <a className="text-blue-700 hover:underline" href={`mailto:${contact}`}>{contact}</a>。运营方会先核验申请人与账号的关系，再依据现有管理能力及适用要求处理，并向你说明无法立即完成的部分。当前没有供用户自行完成账号注销的在线入口。</p>
                </Section>
            </article>
        </main>
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return <section className="mt-9 space-y-3 leading-7"><h2 className="text-lg font-semibold">{title}</h2>{children}</section>;
}
