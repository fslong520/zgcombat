#include<iostream>
using namespace std;

int n,m,aa,bb;
int a[114][514];
int b[114][514];
int c;

bool check(int i,int j)
{
    for(int y=0;y<aa;++y)
    {
        for(int x=0;x<bb;++x)
        {
            if(a[i+y][j+x]!=b[y][x])
            {
                //cout<<a[i+y][j+x]<<' '<<b[y][x]<<endl;
                return 0;
            }
        }
    }
    return 1;
}


int main()
{
    cin>>n>>m;
    for(int i=0; i<n;++i) for(int j=0;j<m;++j) cin>>a[i][j];
    cin>>aa>>bb;
    for(int i=0;i<aa;++i) for(int j=0;j<bb;++j) cin>>b[i][j];
    for(int i=0;i<n-aa+1;++i)
    {
        for(int j=0;j<m-bb+1;++j)
        {
            c+=check(i,j);
        }
    }
    cout<<c;
    return 0;
}
