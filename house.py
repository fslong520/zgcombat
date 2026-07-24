from turtle import *

def zeichne_haus(groesse):
    """绘制一个尺寸为 groesse 的尼古拉斯房子"""
    # 画正方形主体
    stiftRunter()
    for _ in range(4):
        geheSchritte(groesse)
        dreheLinksGrad(90)
    
    # 画三角形屋顶
    stiftHoch()
    # 移动到正方形左上角
    dreheLinksGrad(90)
    geheSchritte(groesse)
    dreheRechtsGrad(90)
    stiftRunter()
    # 画等边三角形屋顶
    dreheRechtsGrad(60)
    geheSchritte(groesse)
    dreheRechtsGrad(120)
    geheSchritte(groesse)
    dreheRechtsGrad(60)

# 绘制三个不同尺寸的房子
stiftHoch()
goto(-200, -100)
stiftRunter()

for s in [50, 100, 150]:
    zeichne_haus(s)
    # 移动到下一个房子位置
    stiftHoch()
    dreheLinksGrad(90)
    geheSchritte(30)
    dreheRechtsGrad(90)
    geheSchritte(s + 50)
    stiftRunter()

done()