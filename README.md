# 角色
* agent: 一個與鏈連接的 server。負責:
  * 與鏈連線(自動重連)
  * 轉遞呼叫與事件
  * agent 需要擴充，將與鏈有關的邏輯用 on, emit, setAction 包裝起來
* connection: 外界透過 connection 來與 agent 連接
