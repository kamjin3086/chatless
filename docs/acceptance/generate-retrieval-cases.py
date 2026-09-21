"""Generate the frozen retrieval evaluation set.

Run:  python docs/acceptance/generate-retrieval-cases.py
Out:  docs/acceptance/retrieval-cases.json

The corpus deliberately mixes four source shapes: a Chinese and an English PDF,
Markdown runbook, DOCX policy, and a session attachment. Every question names the
chunk ids that contain the answer, so Recall@8 can be measured against the
original text rather than against a model answer.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent

documents = [
    {
        "id": "doc-cn-pdf",
        "title": "CNC-7 主轴设备手册.pdf",
        "type": "pdf",
        "scope": "library",
        "chunks": [
            {"id": "cn-pdf-1", "page": 3, "text":
                "HX-450 主轴驱动器额定功率 15 千瓦，连续工作温度上限 55 摄氏度。超过该温度时驱动器会自动降额运行。"},
            {"id": "cn-pdf-2", "page": 4, "text":
                "当负载超过额定值时，过载保护会在 2 秒内切断输出。复位按钮位于驱动器正面左下角，需要断电复位。"},
            {"id": "cn-pdf-3", "page": 5, "text":
                "冷却液回路压力应保持在 0.35 兆帕到 0.45 兆帕之间。压力低于 0.30 兆帕会触发低压报警并停止主轴。"},
            {"id": "cn-pdf-4", "page": 7, "text":
                "更换轴承时必须使用 T-220 专用工具。错误使用普通拉马会导致轴颈拉伤，属于人为损坏，不在保修范围内。"},
            {"id": "cn-pdf-5", "page": 9, "text":
                "年度保养需要紧固全部地脚螺栓，扭矩值为 120 牛米。保养记录必须保存五年以上。手册建议的常规保养周期为 90 天。"},
        ],
    },
    {
        "id": "doc-cn-md",
        "title": "夜间巡检SOP.md",
        "type": "markdown",
        "scope": "library",
        "chunks": [
            {"id": "cn-md-1", "heading": "1 巡检准备", "text":
                "夜间巡检每两小时执行一次，共四次。巡检人员必须携带红外测温仪和照度计，进入车间前核对当班人员名单。"},
            {"id": "cn-md-2", "heading": "2 主轴检查", "text":
                "主轴轴承温度超过 70 摄氏度立即上报班长，并记录到巡检表格的异常栏。不得自行停机等待冷却。"},
            {"id": "cn-md-3", "heading": "3 熔断处理", "text":
                "控制柜熔断器熔断后，只允许更换同规格熔断器。禁止使用铜丝替代，也禁止短接熔断器座。"},
            {"id": "cn-md-4", "heading": "4 交接班", "text":
                "交接班记录必须写明当班产量、异常次数和未完成的维修工单编号。接班人员未签字前，交班人员不得离岗。"},
        ],
    },
    {
        "id": "doc-cn-docx",
        "title": "设备采购与折旧管理办法.docx",
        "type": "docx",
        "scope": "library",
        "chunks": [
            {"id": "cn-docx-1", "heading": "第三章 折旧", "text":
                "生产设备按十年直线法计提折旧，残值率百分之五。折旧年限变更必须经财务负责人和设备部共同审批。"},
            {"id": "cn-docx-2", "heading": "第四章 采购", "text":
                "单台设备预算超过 30 万元需要总经理审批，超过 100 万元还需要董事会决议。预算金额以含税价为口径。"},
            {"id": "cn-docx-3", "heading": "第五章 报废", "text":
                "设备报废申请需要附第三方检测报告。缺少检测报告的报废申请一律退回，不得先行处置设备。"},
        ],
    },
    {
        "id": "doc-en-pdf",
        "title": "Controller Error Codes.pdf",
        "type": "pdf",
        "scope": "library",
        "chunks": [
            {"id": "en-pdf-1", "page": 12, "text":
                "E-1042 means the spindle encoder signal is lost. Check the encoder cable shield grounding before replacing the encoder."},
            {"id": "en-pdf-2", "page": 13, "text":
                "E-2207 indicates coolant pressure below 0.30 MPa. The controller stops the spindle and keeps the alarm until the pressure recovers."},
            {"id": "en-pdf-3", "page": 18, "text":
                "A HX-450 drive reports F-77 when the DC bus voltage exceeds 780 V. Reduce the deceleration ramp before adding a brake resistor."},
            {"id": "en-pdf-4", "page": 21, "text":
                "Resetting the controller clears only the active alarm buffer. The historical alarm log is kept for 30 days and cannot be cleared manually."},
        ],
    },
    {
        "id": "doc-en-md",
        "title": "oncall-runbook.md",
        "type": "markdown",
        "scope": "library",
        "chunks": [
            {"id": "en-md-1", "heading": "Escalation", "text":
                "Escalate any spindle alarm to the mechanical on-call engineer within 15 minutes. Do not reboot the controller before the alarm log is downloaded."},
            {"id": "en-md-2", "heading": "Logs", "text":
                "Alarm logs are exported with the command hxlog export --since 30d --format csv. The export takes about four minutes on a busy controller."},
            {"id": "en-md-3", "heading": "Spares", "text":
                "The spare encoder kit part number is ENC-22-KIT. Only two kits are kept on site; replenishment is triggered by the weekly stock check."},
            {"id": "en-md-4", "heading": "Safety", "text":
                "Lock out the main breaker before opening the control cabinet. Verifying zero voltage is mandatory even after the lockout tag is applied."},
        ],
    },
    {
        "id": "doc-en-docx",
        "title": "Maintenance Contract Terms.docx",
        "type": "docx",
        "scope": "library",
        "chunks": [
            {"id": "en-docx-1", "heading": "Response times", "text":
                "Critical faults have a four hour response target and a next business day repair target. Non-critical faults follow a three business day schedule."},
            {"id": "en-docx-2", "heading": "Penalties", "text":
                "Missing the response target three times in one quarter reduces the service fee by 8 percent for that quarter."},
            {"id": "en-docx-3", "heading": "Coverage", "text":
                "Consumables such as coolant filters and wiper blades are excluded from the contract and are billed separately."},
        ],
    },
    {
        "id": "doc-attach-meeting",
        "title": "2026-08 设备评审会议纪要.txt",
        "type": "txt",
        "scope": "attachment",
        "chunks": [
            {"id": "att-1", "text":
                "会议决定把 HX-450 的保养周期从 90 天调整为 60 天，原因是上季度出现过两次轴承温升异常。"},
            {"id": "att-2", "text":
                "会议同时确认 E-1042 高发与编码器线缆走向有关，需要在九月完成线缆整改，负责人为张工。"},
            {"id": "att-3", "text":
                "会议记录人：李敏。下次评审时间定在 2026 年 10 月 12 日，地点为二号车间会议室。"},
        ],
    },
]


def q(case_id, lang, kind, query, expected, mode="lexical", note=""):
    case = {"id": case_id, "lang": lang, "kind": kind, "query": query,
            "expected": expected, "mode": mode}
    if note:
        case["note"] = note
    return case


cases = [
    # ---- Chinese, lexical: short words, model numbers, numbers ----
    q("zh-short-01", "zh", "fact", "过载保护 复位", ["cn-pdf-2"]),
    q("zh-short-02", "zh", "fact", "熔断器 铜丝", ["cn-md-3"]),
    q("zh-short-03", "zh", "fact", "折旧 残值率", ["cn-docx-1"]),
    q("zh-short-04", "zh", "fact", "冷却液 低压报警", ["cn-pdf-3"]),
    q("zh-short-05", "zh", "fact", "巡检 红外测温仪", ["cn-md-1"]),
    q("zh-short-06", "zh", "fact", "型号 HX-450 额定功率", ["cn-pdf-1"]),
    q("zh-short-07", "zh", "fact", "轴承 人工损坏 保修", ["cn-pdf-4"], note="型号 T-220 与保修口径"),
    q("zh-num-01", "zh", "fact", "地脚螺栓 扭矩 牛米", ["cn-pdf-5"]),
    q("zh-num-02", "zh", "fact", "轴承温度 70 摄氏度", ["cn-md-2"]),
    q("zh-num-03", "zh", "fact", "预算 30 万元 总经理审批", ["cn-docx-2"]),
    q("zh-num-04", "zh", "fact", "回路压力 0.45 兆帕", ["cn-pdf-3"]),
    q("zh-num-05", "zh", "fact", "连续工作温度 55 摄氏度", ["cn-pdf-1"]),
    q("zh-sop-01", "zh", "fact", "交接班 未签字 离岗", ["cn-md-4"]),
    q("zh-sop-02", "zh", "fact", "报废申请 第三方检测报告", ["cn-docx-3"]),
    q("zh-sop-03", "zh", "fact", "巡检 每两小时 四次", ["cn-md-1"]),
    q("zh-sop-04", "zh", "fact", "主轴轴承 上报班长", ["cn-md-2"]),
    q("zh-sop-05", "zh", "fact", "更换轴承 T-220 专用工具", ["cn-pdf-4"]),
    q("zh-sop-06", "zh", "fact", "年度保养 地脚螺栓 五年", ["cn-pdf-5"]),
    q("zh-scope-01", "zh", "fact", "保养周期 90 天 调整为 60 天", ["att-1"], note="会话附件"),
    q("zh-scope-02", "zh", "fact", "编码器线缆整改 负责人", ["att-2"], note="会话附件"),
    q("zh-scope-03", "zh", "fact", "下次评审 二号车间会议室", ["att-3"], note="会话附件"),
    q("zh-conflict-01", "zh", "conflict", "HX-450 保养周期", ["att-1", "cn-pdf-5"],
      note="会议调整了保养周期，需同时召回手册保养章节与会议决定"),
    q("zh-cross-01", "zh", "cross-doc", "编码器 E-1042 原因", ["en-pdf-1", "att-2"]),
    q("zh-cross-02", "zh", "cross-doc", "HX-450 主轴 温度异常", ["cn-pdf-1", "att-1"]),

    # ---- English, lexical: codes, identifiers, numbers ----
    q("en-code-01", "en", "fact", "E-1042 encoder", ["en-pdf-1"]),
    q("en-code-02", "en", "fact", "E-2207 coolant pressure", ["en-pdf-2"]),
    q("en-code-03", "en", "fact", "F-77 DC bus voltage", ["en-pdf-3"]),
    q("en-code-04", "en", "fact", "alarm log 30 days", ["en-pdf-4"]),
    q("en-cmd-01", "en", "fact", "hxlog export csv", ["en-md-2"]),
    q("en-part-01", "en", "fact", "ENC-22-KIT spare encoder", ["en-md-3"]),
    q("en-num-01", "en", "fact", "780 V brake resistor", ["en-pdf-3"]),
    q("en-num-02", "en", "fact", "0.30 MPa controller stops spindle", ["en-pdf-2"]),
    q("en-num-03", "en", "fact", "four hour response target", ["en-docx-1"]),
    q("en-num-04", "en", "fact", "8 percent service fee", ["en-docx-2"]),
    q("en-sop-01", "en", "fact", "lock out main breaker", ["en-md-4"]),
    q("en-sop-02", "en", "fact", "escalate spindle alarm 15 minutes", ["en-md-1"]),
    q("en-sop-03", "en", "fact", "consumables coolant filters excluded", ["en-docx-3"]),
    q("en-sop-04", "en", "fact", "alarm buffer historical log", ["en-pdf-4"]),
    q("en-sop-05", "en", "fact", "reboot controller before alarm log downloaded", ["en-md-1"]),
    q("en-sop-06", "en", "fact", "replenishment weekly stock check", ["en-md-3"]),
    q("en-scope-01", "en", "fact", "next review October 12", ["att-3"], note="中文附件里的英文日期"),
    q("en-cross-01", "en", "cross-doc", "E-1042 cable routing", ["en-pdf-1", "att-2"]),
    q("en-cross-02", "en", "cross-doc", "HX-450 保养周期 maintenance interval", ["att-1", "cn-pdf-5"],
      note="双语查询：手册周期与会议调整分处中英文资料"),

    # ---- Questions the corpus cannot answer: the retriever must return nothing
    # relevant rather than a plausible-looking neighbour. ----
    q("none-01", "zh", "no-answer", "液压泵站 伺服阀 校准", []),
    q("none-02", "zh", "no-answer", "员工餐厅 菜单 补贴", []),
    q("none-03", "en", "no-answer", "laser cutter nozzle diameter", []),
    q("none-04", "en", "no-answer", "vacation carryover entitlement", []),

    # ---- Mixed language and punctuation robustness ----
    q("mix-01", "zh", "fact", "hx-450 驱动器 F-77", ["en-pdf-3"]),
    q("mix-02", "zh", "fact", "E-1042 编码器 屏蔽接地", ["en-pdf-1"]),
    q("mix-03", "en", "fact", "T-220 轴承工具", ["cn-pdf-4"]),
    q("mix-04", "zh", "fact", "0.30 MPa 低压", ["en-pdf-2"]),
    q("mix-05", "en", "fact", "残值率 depreciation", ["cn-docx-1"]),
    q("mix-06", "zh", "fact", "ENC-22-KIT 备件", ["en-md-3"]),
    q("mix-07", "en", "fact", "过载保护 overload", ["cn-pdf-2"]),
    q("mix-08", "zh", "fact", "熔断器 fuse", ["cn-md-3"]),
    q("mix-09", "en", "fact", "巡检 照度计", ["cn-md-1"]),
    q("mix-10", "zh", "fact", "张工 线缆", ["att-2"]),
    q("zh-fact-07", "zh", "fact", "主轴 降额运行", ["cn-pdf-1"]),
    q("zh-fact-08", "zh", "fact", "未完成的维修工单编号", ["cn-md-4"]),
    q("zh-fact-09", "zh", "fact", "100 万元 董事会决议", ["cn-docx-2"]),
    q("en-fact-07", "en", "fact", "shield grounding encoder cable", ["en-pdf-1"]),
    q("en-fact-08", "en", "fact", "deceleration ramp DC bus", ["en-pdf-3"]),
    q("mix-11", "zh", "fact", "低压报警 主轴停止", ["cn-pdf-3"]),
]

payload = {"version": 1,
           "generatedBy": "docs/acceptance/generate-retrieval-cases.py",
           "documents": documents,
           "cases": cases}

if __name__ == "__main__":
    (ROOT / "retrieval-cases.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    chunks = sum(len(d["chunks"]) for d in documents)
    print(f"documents={len(documents)} chunks={chunks} cases={len(cases)}")
