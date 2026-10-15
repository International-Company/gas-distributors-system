/**
 * شاشة البداية عند فتح التطبيق المثبّت (لا تظهر في المتصفح العادي ولا عند التنقل بين الصفحات).
 * تُرسم مع الصفحة نفسها قبل تحميل أي سكربت، فتكمل شاشة النظام (الخلفية الزرقاء نفسها) بلا وميض،
 * ثم تتلاشى عند جاهزية الصفحة. تظهر مرة واحدة في كل جلسة.
 * ألوانها ثابتة (لون الهوية) في الوضعين الفاتح والداكن، مطابقة لـ background_color في بيان التطبيق.
 */
export const SPLASH_BG = "#1e5aa8";

const script = `(function(){try{
var s=document.getElementById("app-splash");if(!s)return;
var installed=matchMedia("(display-mode: standalone)").matches||matchMedia("(display-mode: fullscreen)").matches||navigator.standalone===true||location.search.indexOf("splash=1")>-1;
if(!installed||sessionStorage.getItem("gas-splash"))return;
sessionStorage.setItem("gas-splash","1");
s.removeAttribute("hidden");var t0=Date.now();
function hide(){s.setAttribute("hidden","")}
function done(){setTimeout(function(){s.setAttribute("data-leaving","");setTimeout(hide,450)},Math.max(0,1100-(Date.now()-t0)))}
if(document.readyState==="complete")done();else addEventListener("load",done);
setTimeout(hide,5000);
}catch(e){}})();`;

export function AppSplash({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return (
    <>
      <div id="app-splash" hidden suppressHydrationWarning role="status" aria-label={`${name} — جاري التحميل`}>
        <div className="app-splash-inner">
          <div className="app-splash-logo">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" width={72} height={72} />
            ) : (
              <svg viewBox="8 4 16 22" width="52" height="72" aria-hidden>
                <path d="M16 6c1 4 6 6.5 6 12a6 6 0 0 1-12 0c0-3 1.5-4.5 3-6 .3 2 1.3 3 2.5 3.3C15 12 15 9 16 6z" fill="#1e5aa8" />
              </svg>
            )}
          </div>
          <div className="app-splash-name">{name}</div>
          <div className="app-splash-bar" aria-hidden><span /></div>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </>
  );
}
