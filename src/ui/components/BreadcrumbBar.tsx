/**
 * 面包屑导航：紫禁城 ＞ 后宫 ＞ 咸福宫，左端带返回箭头。
 * 返回箭头执行 onBack（语义：上一层），让用户清楚会回到哪里。
 * 中间层级若可点（onCrumb 提供）则作为跳层入口；末项为当前位置，不可点。
 */
export function BreadcrumbBar({
  crumbs,
  onBack,
  onCrumb,
}: {
  crumbs: string[];
  onBack?: () => void;
  onCrumb?: (index: number) => void;
}) {
  if (crumbs.length === 0) return null;
  const last = crumbs.length - 1;
  return (
    <nav className="breadcrumb" aria-label="位置">
      {onBack && (
        <button type="button" className="breadcrumb__back" onClick={onBack} aria-label="返回上一层">
          ‹
        </button>
      )}
      <ol className="breadcrumb__trail">
        {crumbs.map((name, i) => (
          <li key={`${name}-${i}`} className="breadcrumb__crumb" aria-current={i === last ? "page" : undefined}>
            {i > 0 && <span className="breadcrumb__sep" aria-hidden="true">＞</span>}
            {i < last && onCrumb ? (
              <button type="button" className="breadcrumb__link" onClick={() => onCrumb(i)}>
                {name}
              </button>
            ) : (
              <span className={i === last ? "breadcrumb__here" : "breadcrumb__static"}>{name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
