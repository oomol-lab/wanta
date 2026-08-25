import type { ConnectionActionCatalogItem } from "../../../electron/connections/common.ts"
import type { Locale } from "@/i18n/i18n"

const zhLingxingActionDescriptions: Record<string, string> = {
  "lingxing.analyze_ad_keywords": "分析商品推广和品牌推广广告的关键词汇总指标。",
  "lingxing.analyze_ad_search_terms": "分析商品推广和品牌推广广告的搜索词汇总指标。",
  "lingxing.batch_get_fba_shipments": "单次批量查询最多 50 个领星 FBA 发货单。",
  "lingxing.batch_get_products": "通过商品 ID、SKU 或 SKU 标识批量查询最多 100 个领星本地商品。",
  "lingxing.get_fba_shipment": "通过发货单号查询一个领星 FBA 发货单。",
  "lingxing.get_fba_shipment_creation_result": "查询异步创建 FBA 发货单请求的处理结果。",
  "lingxing.get_product": "通过商品 ID、SKU 或 SKU 标识查询一个领星本地商品。",
  "lingxing.list_accounts": "列出领星企业中已启用的所有 ERP 用户账号。",
  "lingxing.list_ad_accounts": "列出领星中已授权的 DSP、卖家或供应商广告账号。",
  "lingxing.list_competitor_monitors": "列出领星中监控的亚马逊竞品。",
  "lingxing.list_concept_sellers": "列出领星 ERP 账号中配置的所有概念店铺。",
  "lingxing.list_currencies": "列出领星 ERP 指定自然月的汇率。",
  "lingxing.list_fba_inventory": "按商品、店铺、库存状态和高级筛选条件查询领星当前的 FBA 库存。",
  "lingxing.list_fba_shipment_carriers": "列出领星 FBA 发货物流可用的头程承运商。",
  "lingxing.list_fba_shipment_fee_types": "列出领星 FBA 发货可用的头程物流附加费类型。",
  "lingxing.list_fba_shipments": "按分页和业务条件查询领星 FBA 发货单。",
  "lingxing.list_keyword_rankings": "列出领星中监控的亚马逊关键词排名。",
  "lingxing.list_listings": "按店铺、配对状态、更新时间和商品条件查询领星中的亚马逊 Listing。",
  "lingxing.list_marketplaces": "列出领星 ERP 账号中配置的所有亚马逊站点。",
  "lingxing.list_msku_profit": "按 MSKU 汇总查询领星利润报表。",
  "lingxing.list_order_profit": "按 MSKU 汇总查询领星订单利润。",
  "lingxing.list_product_performance": "按 ASIN、父 ASIN、MSKU 或本地 SKU 汇总查询亚马逊商品表现。",
  "lingxing.list_products": "按分页、时间范围和 SKU 条件查询领星本地商品。",
  "lingxing.list_sb_ad_group_reports": "查询指定报表日期的品牌推广广告组表现。",
  "lingxing.list_sb_campaign_reports": "查询指定报表日期的品牌推广广告活动表现。",
  "lingxing.list_sb_product_ad_reports": "查询指定报表日期的品牌推广广告创意表现。",
  "lingxing.list_sb_target_reports": "查询指定报表日期的品牌推广投放表现。",
  "lingxing.list_sd_ad_group_reports": "查询指定报表日期的展示型推广广告组表现。",
  "lingxing.list_sd_campaign_reports": "查询指定报表日期的展示型推广广告活动表现。",
  "lingxing.list_sd_product_ad_reports": "查询指定报表日期的展示型推广广告商品表现。",
  "lingxing.list_sd_target_reports": "查询指定报表日期的展示型推广投放表现。",
  "lingxing.list_sellers": "列出领星 ERP 账号中已授权的所有亚马逊店铺。",
  "lingxing.list_sp_ad_group_reports": "查询指定报表日期的商品推广广告组表现。",
  "lingxing.list_sp_campaign_reports": "查询指定报表日期的商品推广广告活动表现。",
  "lingxing.list_sp_product_ad_reports": "查询指定报表日期的商品推广广告商品表现。",
  "lingxing.list_sp_target_reports": "查询指定报表日期的商品推广投放表现。",
  "lingxing.list_states": "列出指定国家的标准州、省代码。",
  "lingxing.list_world_states": "列出领星中指定亚马逊国家的州和省。",
}

export function localizeConnectionActions(
  service: string,
  actions: ConnectionActionCatalogItem[],
  locale: Locale,
): ConnectionActionCatalogItem[] {
  if (locale !== "zh-CN" || service !== "lingxing") return actions
  let changed = false
  const localized = actions.map((action) => {
    const description = zhLingxingActionDescriptions[action.id]
    if (!description || description === action.description) return action
    changed = true
    return { ...action, description }
  })
  return changed ? localized : actions
}
